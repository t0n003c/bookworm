"""LLM streaming client — Phase 3, Hybrid Search Q&A.

Sends the top search results as context to any OpenAI-compatible endpoint
and streams token chunks back as an async generator.

Design rules:
- If `qa_llm_endpoint` is empty in site_settings → yields nothing silently
  (pure-retrieval fallback; no error shown to user).
- API key is optional — some local endpoints (Ollama, LM Studio) don't need one.
- Newlines in tokens are preserved; caller must handle SSE line-break escaping.
- No proxy by default; set BW_HTTP_PROXY env var if your LLM endpoint needs one.
"""
import json
import logging
import os
import sqlite3
from typing import AsyncGenerator

import httpx

from database import DB_PATH
from routers.auth_db import get_qa_settings

log = logging.getLogger(__name__)

_CONTEXT_NOTES  = 5      # how many notes to pass as context
_MAX_NOTE_CHARS = 2_000  # truncation per note (title + content)
_LLM_TIMEOUT    = 60.0   # seconds for the full stream


def _fetch_contexts_sync(note_ids: list, uid: int) -> list:
    """Sync sqlite fetch of note title + content (runs in executor)."""
    if not note_ids:
        return []
    placeholders = ",".join("?" * len(note_ids))
    sql = f"""
        SELECT n.id, n.title, n.content
        FROM   notes n
        JOIN   workspaces w ON w.id = n.workspace_id AND w.user_id = ?
                            AND w.deleted_at IS NULL
        WHERE  n.id IN ({placeholders})
    """
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(sql, [uid, *note_ids]).fetchall()
    finally:
        conn.close()
    # Preserve caller-supplied order (search rank)
    order = {nid: i for i, nid in enumerate(note_ids)}
    rows  = sorted(rows, key=lambda r: order.get(r["id"], 999))
    return [{"title": r["title"] or "Untitled", "content": r["content"] or ""}
            for r in rows]


def _build_context_block(notes: list) -> str:
    """Format notes into a context string for the system prompt."""
    parts = []
    for i, n in enumerate(notes, 1):
        text = (n["content"] or "").strip()
        combined = f"**{n['title']}**\n{text}"
        if len(combined) > _MAX_NOTE_CHARS:
            combined = combined[:_MAX_NOTE_CHARS] + "…"
        parts.append(f"[Note {i}]\n{combined}")
    return "\n\n---\n\n".join(parts)


async def stream_llm(
    question: str,
    note_ids: list,
    uid: int,
) -> AsyncGenerator[str, None]:
    """Async generator — yields token strings from the LLM.

    Fetches note contexts in an executor, then streams from the configured
    OpenAI-compatible endpoint. Yields nothing if endpoint is unconfigured.
    """
    cfg = await get_qa_settings()
    if not cfg["endpoint"]:
        return  # pure retrieval fallback — no LLM configured

    # Fetch note content in the thread pool
    import asyncio
    loop = asyncio.get_running_loop()
    notes = await loop.run_in_executor(
        None, _fetch_contexts_sync, note_ids[:_CONTEXT_NOTES], uid
    )
    if not notes:
        return

    context = _build_context_block(notes)
    system_prompt = (
        "You are a helpful assistant. Answer the user's question using ONLY "
        "the notes provided below. Be concise. If the notes don't contain "
        "enough information, say so briefly.\n\n"
        f"=== Notes ===\n{context}\n=== End of Notes ==="
    )
    messages = [
        {"role": "system",  "content": system_prompt},
        {"role": "user",    "content": question},
    ]
    headers = {"Content-Type": "application/json"}
    if cfg["api_key"]:
        headers["Authorization"] = f"Bearer {cfg['api_key']}"

    payload = {
        "model":       cfg["model"] or "gpt-4o-mini",
        "messages":    messages,
        "stream":      True,
        "temperature": 0.3,
        "max_tokens":  512,
    }

    proxy = os.getenv("BW_HTTP_PROXY") or None
    endpoint = cfg["endpoint"].rstrip("/") + "/chat/completions"

    try:
        async with httpx.AsyncClient(
            proxy=proxy, timeout=_LLM_TIMEOUT, follow_redirects=True
        ) as client:
            async with client.stream(
                "POST", endpoint, json=payload, headers=headers
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    raw = line[5:].strip()
                    if raw == "[DONE]":
                        break
                    try:
                        chunk = json.loads(raw)
                        token = (
                            chunk.get("choices", [{}])[0]
                            .get("delta", {})
                            .get("content") or ""
                        )
                        if token:
                            yield token
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
    except Exception:
        log.exception("search_llm: stream failed")
