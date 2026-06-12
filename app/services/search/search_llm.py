"""LLM streaming client — Phase 3+4, Hybrid Search Q&A.

Sends the top search results as context to any OpenAI-compatible endpoint
and streams token chunks back as an async generator.

Design rules:
- Each user must configure their own LLM endpoint + API key in Account → AI Search.
- If a user has no endpoint set → yields nothing silently (pure-retrieval fallback).
- API key is optional — some local endpoints (Ollama, LM Studio) don't need one.
- Newlines in tokens are preserved; caller must handle SSE line-break escaping.
- No proxy by default; set BW_HTTP_PROXY env var if your LLM endpoint needs one.
- Token usage is captured via stream_options and written to ai_usage_log after
  every successful stream.  cost_usd is NULL for unknown/local models.
"""
import json
import logging
import os
import sqlite3
from typing import AsyncGenerator

import httpx

from app.core.db import DB_PATH
from app.api.auth_db import get_user_llm_settings

log = logging.getLogger(__name__)

_CONTEXT_NOTES  = 5      # how many items to pass as context
_MAX_NOTE_CHARS = 2_000  # truncation per item (title + content)
_LLM_TIMEOUT    = 60.0   # seconds for the full stream

# ── Known model pricing (USD per 1 million tokens) ────────────────────────────────
# Matched by substring so "gpt-4o-mini-2024-07" also matches "gpt-4o-mini".
# Update when OpenAI changes pricing at https://openai.com/api/pricing/
# Local endpoints (Ollama, LM Studio, etc.) are intentionally absent —
# cost will be stored as NULL for those.
_MODEL_COSTS: dict[str, tuple[float, float]] = {
    # (input $/1M, output $/1M)
    "gpt-4o-mini":          (0.15,   0.60),
    "gpt-4o":               (2.50,  10.00),
    "gpt-4.1-nano":         (0.10,   0.40),
    "gpt-4.1-mini":         (0.40,   1.60),
    "gpt-4.1":              (2.00,   8.00),
    "gpt-4-turbo":          (10.00, 30.00),
    "gpt-3.5-turbo":        (0.50,   1.50),
    "o1-mini":              (1.10,   4.40),
    "o1":                   (15.00, 60.00),
    "o3-mini":              (1.10,   4.40),
}


def _estimate_cost(model: str, input_tok: int, output_tok: int) -> float | None:
    """Return estimated USD cost or None if the model isn’t in _MODEL_COSTS."""
    model_lower = model.lower()
    for key, (inp_rate, out_rate) in _MODEL_COSTS.items():
        if key in model_lower:
            return (input_tok * inp_rate + output_tok * out_rate) / 1_000_000
    return None


def _save_usage_sync(
    uid: int, model: str, input_tok: int, output_tok: int,
    cost: float | None, query: str, answer: str,
) -> None:
    """Write one row to ai_usage_log.  Runs in a thread-pool executor.

    Uses WAL journal mode to stay consistent with the rest of the app.
    """
    try:
        conn = sqlite3.connect(str(DB_PATH), timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "INSERT INTO ai_usage_log "
            "(user_id, model, input_tokens, output_tokens, cost_usd, query_text, answer_text) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (uid, model, input_tok, output_tok, cost, query[:500], answer[:4000]),
        )
        conn.commit()
    except Exception:
        log.exception("search_llm: failed to write ai_usage_log")
    finally:
        conn.close()


async def get_effective_llm_settings(uid: int) -> dict:
    """Return the LLM config to use for this user.

    Users must configure their own endpoint in Account → AI Search.
    Returns all-empty dict if no personal key is set → caller yields nothing.
    API key is never returned to the browser — this function is server-only.
    """
    user_cfg = await get_user_llm_settings(uid)
    if user_cfg["endpoint"]:
        return {
            "endpoint": user_cfg["endpoint"],
            "api_key":  user_cfg["api_key"],
            "model":    user_cfg["model"] or "gpt-4o-mini",
        }
    return {"endpoint": "", "api_key": "", "model": ""}


def _fetch_contexts_sync(items: list, uid: int) -> list:
    """Sync sqlite fetch of text context for the top search items (runs in executor).

    items: [{item_type, item_id}] — notes, db_cards, and crm_contacts are fetched;
    workspaces and widgets are skipped (not enough text for useful LLM context).
    """
    if not items:
        return []

    note_ids    = [it["item_id"] for it in items if it["item_type"] == "note"]
    card_ids    = [it["item_id"] for it in items if it["item_type"] == "db_card"]
    contact_ids = [it["item_id"] for it in items if it["item_type"] == "crm_contact"]

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

        # CRM contacts — core fields + custom field values + last 10 conversations
        if contact_ids:
            ph = ",".join("?" * len(contact_ids))
            c_rows = conn.execute(
                f"SELECT id, user_id, name, email, phone, company, "
                f"       tags, relationship, address "
                f"FROM crm_contacts WHERE id IN ({ph}) AND user_id = ?",
                [*contact_ids, uid],
            ).fetchall()
            for c in c_rows:
                parts = []
                for field in ("email", "phone", "company", "tags", "address"):
                    val = (c[field] or "").strip()
                    if val:
                        parts.append(f"{field.title()}: {val}")
                # Relationship (may be JSON array)
                rel = (c["relationship"] or "").strip()
                if rel:
                    if rel.startswith("["):
                        try:
                            rel = ", ".join(json.loads(rel))
                        except Exception:
                            pass
                    parts.append(f"Relationship: {rel}")
                # Custom field values
                cf_rows = conn.execute(
                    "SELECT cf.label, cfv.value "
                    "FROM crm_contact_field_values cfv "
                    "JOIN crm_custom_fields cf ON cf.id = cfv.field_id "
                    "WHERE cfv.contact_id = ? AND cfv.value != ''",
                    (c["id"],),
                ).fetchall()
                for cf in cf_rows:
                    parts.append(f"{cf['label']}: {cf['value']}")
                # Last 10 conversations
                convos = conn.execute(
                    "SELECT note, logged_at FROM crm_conversation_log "
                    "WHERE contact_id = ? ORDER BY logged_at DESC, id DESC LIMIT 10",
                    (c["id"],),
                ).fetchall()
                if convos:
                    parts.append("Recent conversations:")
                    for convo in convos:
                        note = (convo["note"] or "").strip()
                        date = (convo["logged_at"] or "")[:10]
                        if note:
                            parts.append(f"  [{date}] {note}")
                results.append({
                    "id": c["id"], "item_type": "crm_contact",
                    "title": c["name"] or "Unnamed Contact",
                    "content": "\n".join(parts),
                })
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
        yield "I couldn't find any relevant notes or contacts to answer that. Try searching with a specific name or keyword first."
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
        "model":          cfg["model"] or "gpt-4o-mini",
        "messages":       messages,
        "stream":         True,
        "stream_options": {"include_usage": True},  # final chunk carries usage stats
        "temperature":    0.3,
        "max_tokens":     512,
    }

    proxy    = os.getenv("BW_HTTP_PROXY") or None
    endpoint = cfg["endpoint"].rstrip("/") + "/chat/completions"
    model    = cfg["model"] or "gpt-4o-mini"

    # Mutable box so the inner loop can write usage data for the finally block.
    _usage: dict = {"input": 0, "output": 0, "captured": False}
    _answer_parts: list = []  # accumulate tokens for history tab

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
                        # Usage chunk: choices is empty, usage key is present.
                        if not chunk.get("choices") and chunk.get("usage"):
                            u = chunk["usage"]
                            _usage["input"]    = u.get("prompt_tokens", 0)
                            _usage["output"]   = u.get("completion_tokens", 0)
                            _usage["captured"] = True
                            continue
                        token = (
                            chunk.get("choices", [{}])[0]
                            .get("delta", {})
                            .get("content") or ""
                        )
                        if token:
                            _answer_parts.append(token)
                            yield token
                    except (json.JSONDecodeError, IndexError, KeyError):
                        continue
    except Exception as exc:
        log.exception("search_llm: stream failed")
        # Yield only the exception type — not str(exc) which may contain
        # the endpoint URL or Bearer token fragment from httpx internals.
        yield f"\u26a0 AI error ({type(exc).__name__}) — check endpoint/key in Account → AI Search."
    finally:
        # Persist usage whether stream finished normally or raised.
        if _usage["captured"] and (_usage["input"] or _usage["output"]):
            inp, out = _usage["input"], _usage["output"]
            cost     = _estimate_cost(model, inp, out)
            answer   = "".join(_answer_parts)
            import asyncio
            loop = asyncio.get_event_loop()
            loop.run_in_executor(
                None, _save_usage_sync, uid, model, inp, out, cost, question, answer
            )
