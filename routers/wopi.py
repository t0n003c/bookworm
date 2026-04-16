"""WOPI host router — lets Collabora Online open/save BookWorm uploads.

These endpoints are called *server-to-server* by the Collabora container,
NOT by the browser.  There is no session cookie present.  Auth is purely via
the signed ?access_token= query parameter (itsdangerous HMAC, short-lived).

Prefix: /wopi
Auth bypass: auth_middleware.py skips /wopi/ via prefix check (like /static/).

Phase 6 WOPI limitation (known): LOCK/UNLOCK/REFRESH_LOCK requests are not
handled.  Collabora works fine in single-user mode without locking; a 200
empty response is returned for those operations.  Locking deferred to Phase 7.
"""
from __future__ import annotations

import asyncio
import os
import xml.etree.ElementTree as ET
from pathlib import Path
from urllib.parse import quote, urlparse, parse_qs

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadSignature

from database import get_db
from routers.attachments_db import UPLOAD_DIR
from routers.uploads_docs_db import update_page_upload_size
from security import load_secret_key

# ── WOPI-eligible MIME types (must match _WOPI_MIMES in home-page-uploads-wopi.js) ──
WOPI_MIMES: frozenset[str] = frozenset({
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # docx
    "application/msword",                                                        # doc
    "application/vnd.oasis.opendocument.text",                                   # odt
    "text/plain",                                                                # txt
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",        # xlsx
    "text/csv",                                                                  # csv
    "application/vnd.openxmlformats-officedocument.presentationml.presentation", # pptx
})

# ── Configuration (read once at import time) ──────────────────────────────────
_COLLABORA_URL: str = os.getenv("BW_COLLABORA_URL", "").rstrip("/")
_WOPI_BASE_URL: str = os.getenv("BW_WOPI_BASE_URL", "").rstrip("/")
_TOKEN_EXPIRY:  int = int(os.getenv("BW_WOPI_TOKEN_EXPIRY", "3600"))

# ── Token helpers ─────────────────────────────────────────────────────────────
_secret = os.getenv("BW_SECRET_KEY") or load_secret_key()
_ser    = URLSafeTimedSerializer(_secret, salt="wopi-token-v1")


def issue_token(file_id: int, user_id: int, page_id: int) -> str:
    """Sign a short-lived WOPI access token embedding fid/uid/pid."""
    return _ser.dumps({"fid": file_id, "uid": user_id, "pid": page_id})


def _validate_token(token: str) -> dict:
    """Deserialise and verify the access token.  Raises 401 on failure."""
    try:
        return _ser.loads(token, max_age=_TOKEN_EXPIRY)
    except (SignatureExpired, BadSignature):
        raise HTTPException(status_code=401, detail="WOPI token invalid or expired")


# ── Discovery XML cache ───────────────────────────────────────────────────────
# Maps mime_type -> urlsrc template string from Collabora's discovery endpoint.
_discovery_cache:  dict[str, str] = {}
_discovery_lock = asyncio.Lock()


async def _refresh_discovery() -> None:
    """Fetch /hosting/discovery from Collabora and populate _discovery_cache.

    Safe to call concurrently — protected by _discovery_lock.
    Raises HTTPException 503 if Collabora is unreachable.
    """
    global _discovery_cache
    if not _COLLABORA_URL:
        return
    async with _discovery_lock:
        # Double-checked locking: another coroutine may have filled it already.
        if _discovery_cache:
            return
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(f"{_COLLABORA_URL}/hosting/discovery")
                r.raise_for_status()
                xml_text = r.text
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Collabora service unavailable: {exc}",
            )
        cache: dict[str, str] = {}
        try:
            root = ET.fromstring(xml_text)
            for app in root.iter("app"):
                mime = app.get("name", "")
                for action in app.findall("action"):
                    if action.get("name") == "edit":
                        urlsrc = action.get("urlsrc", "")
                        if urlsrc and mime:
                            cache[mime] = urlsrc
        except ET.ParseError as exc:
            raise HTTPException(
                status_code=503,
                detail=f"Collabora discovery XML parse error: {exc}",
            )
        _discovery_cache = cache


async def get_editor_url(mime_type: str, wopi_src: str, token: str) -> str:
    """Build the browser-facing Collabora editor URL for a given MIME type.

    Fetches discovery XML on first call (cached for the process lifetime).
    Raises 503 if Collabora is down; 422 if the MIME type is unsupported.
    """
    if not _discovery_cache:
        await _refresh_discovery()

    urlsrc = _discovery_cache.get(mime_type)
    if not urlsrc:
        raise HTTPException(
            status_code=422,
            detail=f"Collabora has no editor for MIME type '{mime_type}'",
        )

    # The urlsrc from discovery contains a base URL followed by query-string
    # placeholder tokens like "<WOPI_SRC=ENCODED>&<ACCESS_TOKEN=>&...".
    # Strategy: take only the scheme+host+path (everything before the "?"),
    # then append just the two essential parameters we control.
    base = urlsrc.split("?")[0]
    return (
        f"{base}"
        f"?WOPISrc={quote(wopi_src, safe='')}"
        f"&access_token={quote(token, safe='')}"
        f"&access_token_ttl={_TOKEN_EXPIRY * 1000}"  # Collabora expects ms
    )


# ── DB helpers ────────────────────────────────────────────────────────────────

async def _get_upload(file_id: int, user_id: int) -> dict:
    """Fetch page_uploads row by id + user_id.  Raises 404 if missing/wrong owner."""
    async with get_db() as db:
        cur = await db.execute(
            "SELECT id, page_id, filename, original_name, mime_type, size, user_id "
            "FROM page_uploads WHERE id = ? AND user_id = ?",
            (file_id, user_id),
        )
        row = await cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="File not found")
    return dict(row)


async def _get_username(user_id: int) -> str:
    async with get_db() as db:
        cur = await db.execute("SELECT username FROM users WHERE id = ?", (user_id,))
        row = await cur.fetchone()
    return row["username"] if row else str(user_id)


# ── Router ────────────────────────────────────────────────────────────────────
router = APIRouter(prefix="/wopi", tags=["wopi"])


@router.get("/files/{file_id}")
async def check_file_info(file_id: int, access_token: str):
    """WOPI CheckFileInfo — called by Collabora before opening a document."""
    claims = _validate_token(access_token)
    if claims["fid"] != file_id:
        raise HTTPException(status_code=403, detail="Token/file mismatch")

    row  = await _get_upload(file_id, claims["uid"])
    path = UPLOAD_DIR / row["filename"]
    size = path.stat().st_size if path.exists() else row["size"]
    username = await _get_username(claims["uid"])

    return {
        "BaseFileName":      row["original_name"],
        "Size":              size,
        "UserId":            str(claims["uid"]),
        "UserFriendlyName":  username,
        "UserCanWrite":      True,
        "SupportsUpdate":    True,
        "SupportsLocks":     False,
        "Version":           "1",
    }


@router.get("/files/{file_id}/contents")
async def get_file(file_id: int, access_token: str):
    """WOPI GetFile — streams raw file bytes to Collabora."""
    claims = _validate_token(access_token)
    if claims["fid"] != file_id:
        raise HTTPException(status_code=403, detail="Token/file mismatch")

    row  = await _get_upload(file_id, claims["uid"])
    path = UPLOAD_DIR / row["filename"]
    if not path.exists():
        raise HTTPException(status_code=404, detail="File data missing from disk")

    def _iter():
        with open(path, "rb") as fh:
            while chunk := fh.read(65536):
                yield chunk

    return StreamingResponse(
        _iter(),
        media_type=row["mime_type"] or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{row["original_name"]}"'},
    )


@router.post("/files/{file_id}/contents")
async def put_file(file_id: int, access_token: str, request: Request):
    """WOPI PutFile — Collabora POSTs updated bytes here on save.

    Body is raw bytes, not JSON.  Read with await request.body().
    """
    claims = _validate_token(access_token)
    if claims["fid"] != file_id:
        raise HTTPException(status_code=403, detail="Token/file mismatch")

    row  = await _get_upload(file_id, claims["uid"])
    path = UPLOAD_DIR / row["filename"]

    data = await request.body()
    path.write_bytes(data)
    await update_page_upload_size(file_id, claims["uid"], len(data))

    return {"ok": True}


# ── WOPI lock stub — return 200 to keep Collabora happy ──────────────────────
# Full locking (concurrent-edit detection) deferred to Phase 7.
@router.post("/files/{file_id}")
async def wopi_lock_stub(file_id: int, access_token: str, request: Request):
    """Stub handler for WOPI LOCK/UNLOCK/REFRESH_LOCK/GET_LOCK operations.

    Collabora sends these via X-WOPI-Override header on POST /files/{id}.
    Returning 200 with empty body satisfies Collabora for single-user editing.
    """
    _validate_token(access_token)
    override = request.headers.get("X-WOPI-Override", "")
    if override == "GET_LOCK":
        return Response(status_code=200, headers={"X-WOPI-Lock": ""})
    return Response(status_code=200)
