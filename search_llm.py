"""LLM streaming client — Phase 3+4, Hybrid Search Q&A.

Sends the top search results as context to any OpenAI-compatible endpoint
and streams token chunks back as an async generator.

Phase 4B additions:
- get_effective_llm_settings(uid): user key → site-wide key → empty (pure retrieval).
- _fetch_contexts_sync() now accepts [{item_type, item_id}] and fetches notes
  and db_cards; workspaces and widgets are skipped (too little text for LLM context).

Design rules:
- If effective endpoint is empty → yields nothing silently (pure-retrieval fallback).
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
from routers.auth_db import get_qa_settings, get_user_llm_settings

log = logging.getLogger(__name__)

_CONTEXT_NOTES  = 5      # how many items to pass as context
_MAX_NOTE_CHARS = 2_000  # truncation per item (title + content)
_LLM_TIMEOUT    = 60.0   # seconds for the full stream


async def get_effective_llm_settings(uid: int) -> dict:
    """Return the LLM config to use for this user.

    Fallback chain: user's own key → site-wide key → all-empty (pure retrieval).
    API key is never returned to the browser — this function is server-only.
    """
    user_cfg = await get_user_llm_settings(uid)
    if user_cfg["endpoint"]:
        # User has their own endpoint configured — use it exclusively.
        return {
            "endpoint": user_cfg["endpoint"],
            "api_key":  user_cfg["api_key"],
            "model":    user_cfg["model"] or "gpt-4o-mini",
        }
    # Fall back to site-wide admin settings.
    site_cfg = await get_qa_settings()
    return site_cfg


def _fetch_contexts_sync(items: list, uid: int) -> list:
    """Sync sqlite fetch of text context for the top search items (runs in executor).

    items: [{item_type, item_id}] — notes and db_cards are fetched;
    workspaces and widgets are skipped (not enough text for useful LLM context).
    """
    if not items:
        return []

    note_ids = [
        it["item_id"] for it in items if it["item_type"] == "note"
    ]
    card_ids = [
        it["item_id"] for it in items if it["item_type"] == "db_card"
    ]

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    results = []
    try:
        # Notes — verify ownership via workspace join
        if note_ids:
            ph = ",".join("?" * len(note_ids))
            rows = conn.execute(
                f"SELECT n.id, n.title, n.content "
                f"FROM notes n "
                f"JOIN workspaces w ON w.id = n.workspace_id AND w.user_id = ? "
                f"                 AND w.deleted_at IS NULL "
                f"WHERE n.id IN ({ph})",
                [uid, *note_ids],
            ).fetchall()
            results.extend(
                {"id": r["id"], "item_type": "note",
                 "title": r["title"] or "Untitled", "content": r["content"] or ""}
                for r in rows
            )

        # DB cards — verify ownership directly
        if card_ids:
            ph = ",".join("?" * len(card_ids))
            rows = conn.execute(
                f"SELECT id, title, note_content AS content "
                f"FROM db_cards "
                f"WHERE id IN ({ph}) AND user_id = ?",
                [*card_ids, uid],
            ).fetchall()
            results.extend(
                {"id": r["id"], "item_type": "db_card",
                 "title": r["title"] or "Untitled", "content": r["content"] or ""}
                for r in rows
            )
    finally:
        conn.close()

    # Preserve caller-supplied order (search rank)
    order = {(it["item_type"], it["item_id"]): i for i, it in enumerate(items)}
    results.sort(key=lambda r: order.get((r["item_type"], r["id"]), 999))
    return results


def _build_context_block(items: list) -> str:
    """Format fetched items into a context string for the system prompt."""
    parts = []
    for i, n in enumerate(items, 1):
        text     = (n["content"] or "").strip()
        combined = f"**{n['title']}**\n{text}"
        if len(combined) > _MAX_NOTE_CHARS:
            combined = combined[:_MAX_NOTE_CHARS] + "…"
        parts.append(f"[Source {i}]\n{combined}")
    return "\n\n---\n\n".join(parts)


async def stream_llm(
    question: str,
    items: list,
    uid: int,
) -> AsyncGenerator[str, None]:
    """Async generator — yields token strings from the LLM.

    items: [{item_type, item_id}] from the hybrid search result.
    Fetches context in an executor, then streams from the configured
    OpenAI-compatible endpoint. Yields nothing if no endpoint is configured.
    """
    cfg = await get_effective_llm_settings(uid)
    if not cfg["endpoint"]:
        return  # pure retrieval fallback — no LLM configured

    # Fetch context in the thread pool
    import asyncio
    loop = asyncio.get_running_loop()
    context_items = await loop.run_in_executor(
        None, _fetch_contexts_sync, items[:_CONTEXT_NOTES], uid
    )
    if not context_items:
        return

    context = _build_context_block(context_items)
    system_prompt = (
        "You are a helpful assistant. Answer the user's question using ONLY "
        "the sources provided below. Be concise. If the sources don't contain "
        "enough information, say so briefly.\n\n"
        f"=== Sources ===\n{context}\n=== End of Sources ==="
    )
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user",   "content": question},
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

    proxy    = os.getenv("BW_HTTP_PROXY") or None
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
