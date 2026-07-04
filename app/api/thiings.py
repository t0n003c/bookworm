"""Thiings icon library endpoints.

Runtime-uploaded Thiings icons live under BW_DATA_DIR so users can add icons
from the app UI without editing the source tree. Bundled/static icons remain
supported through static/data/thiings-icons.json and static/img/thiings.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from app.core.db import DATA_DIR
from core.deps import current_user_id

router = APIRouter(prefix="/thiings", tags=["thiings"])

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,90}$")
_MAX_ICON_BYTES = 2 * 1024 * 1024
_DATA_DIR = DATA_DIR / "thiings"
_ICON_DIR = _DATA_DIR / "icons"
_MANIFEST = _DATA_DIR / "manifest.json"
_STATIC_MANIFEST = Path("static/data/thiings-icons.json")
_STATIC_ICON_DIR = Path("static/img/thiings")
def _demo_guard(request: Request):
    if request.session.get("is_demo"):
        return JSONResponse({"error": "Demo mode cannot add shared icons."}, status_code=403)
    return None


def _slugify(value: str) -> str:
    slug = (value or "").strip().lower()
    slug = re.sub(r"[^a-z0-9]+", "-", slug).strip("-")
    slug = re.sub(r"-{2,}", "-", slug)
    return slug[:90]


def _icon_kind(data: bytes) -> tuple[str, str] | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png", "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg", "image/jpeg"
    if data.startswith(b"GIF87a") or data.startswith(b"GIF89a"):
        return "gif", "image/gif"
    if len(data) >= 12 and data[0:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp", "image/webp"
    return None


def _load_json(path: Path) -> list[dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []
    return data if isinstance(data, list) else []


def _clean_entry(entry: dict, runtime: bool) -> dict | None:
    slug = _slugify(str(entry.get("slug") or entry.get("id") or ""))
    if not slug or not _SLUG_RE.match(slug):
        return None
    name = str(entry.get("name") or slug.replace("-", " ")).strip()[:120]
    tags_raw = entry.get("tags") or []
    if isinstance(tags_raw, str):
        tags = [t.strip() for t in re.split(r"[, ]+", tags_raw) if t.strip()]
    elif isinstance(tags_raw, list):
        tags = [str(t).strip() for t in tags_raw if str(t).strip()]
    else:
        tags = []
    ext = str(entry.get("ext") or "png").strip().lower()
    if ext not in {"png", "jpg", "gif", "webp"}:
        ext = "png"
    src = f"/thiings/icons/{slug}.{ext}" if runtime else str(
        entry.get("src") or f"/thiings/icons/{slug}.png"
    )
    return {"slug": slug, "name": name, "tags": tags[:20], "src": src, "ext": ext}


def _runtime_entries() -> list[dict]:
    return [e for e in (_clean_entry(x, True) for x in _load_json(_MANIFEST)) if e]


def _write_runtime_entries(entries: list[dict]) -> None:
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    cleaned = [e for e in (_clean_entry(x, True) for x in entries) if e]
    _MANIFEST.write_text(json.dumps(cleaned, indent=2) + "\n", encoding="utf-8")


@router.get("/manifest")
async def thiings_manifest():
    """Return bundled + runtime Thiings icons."""
    static_entries = [_clean_entry(x, False) for x in _load_json(_STATIC_MANIFEST)]
    runtime_entries = _runtime_entries()
    by_slug: dict[str, dict] = {}
    for entry in static_entries + runtime_entries:
        if entry:
            by_slug[entry["slug"]] = entry
    return JSONResponse(sorted(by_slug.values(), key=lambda e: e["name"].lower()))


@router.get("/icons/{filename}")
async def thiings_icon(filename: str):
    """Serve a runtime icon, falling back to bundled static icons."""
    stem = Path(filename).stem
    ext = Path(filename).suffix.lower().lstrip(".") or "png"
    if not _SLUG_RE.match(stem) or ext not in {"png", "jpg", "gif", "webp"}:
        raise HTTPException(status_code=404)

    candidates = [_ICON_DIR / f"{stem}.{ext}"]
    if ext == "png":
        candidates.extend(_ICON_DIR / f"{stem}.{e}" for e in ("webp", "jpg", "gif"))
        candidates.append(_STATIC_ICON_DIR / f"{stem}.png")
    for path in candidates:
        if path.exists() and path.is_file():
            actual_ext = path.suffix.lower().lstrip(".")
            media = {
                "png": "image/png",
                "jpg": "image/jpeg",
                "gif": "image/gif",
                "webp": "image/webp",
            }.get(actual_ext, "application/octet-stream")
            return FileResponse(path, media_type=media)
    raise HTTPException(status_code=404)


@router.post("/upload")
async def upload_thiing_icon(
    request: Request,
    file: UploadFile = File(...),
    name: str = Form(""),
    slug: str = Form(""),
    tags: str = Form(""),
):
    """Add a licensed Thiings-style icon to the runtime library."""
    current_user_id(request, detail=None)
    if guard := _demo_guard(request):
        return guard

    raw = await file.read(_MAX_ICON_BYTES + 1)
    if len(raw) > _MAX_ICON_BYTES:
        return JSONResponse({"error": "Icon must be 2 MB or smaller."}, status_code=400)
    kind = _icon_kind(raw)
    if not kind:
        return JSONResponse({"error": "Use a PNG, WebP, JPG, or GIF image."}, status_code=400)
    ext, _media = kind

    clean_name = (name or Path(file.filename or "").stem or "Thiings icon").strip()[:120]
    clean_slug = _slugify(slug or clean_name)
    if not clean_slug or not _SLUG_RE.match(clean_slug):
        return JSONResponse({"error": "Icon name must include letters or numbers."}, status_code=400)

    _ICON_DIR.mkdir(parents=True, exist_ok=True)
    out_path = _ICON_DIR / f"{clean_slug}.{ext}"
    out_path.write_bytes(raw)

    entries = [e for e in _runtime_entries() if e["slug"] != clean_slug]
    entry = {
        "slug": clean_slug,
        "name": clean_name,
        "tags": [t.strip() for t in re.split(r"[, ]+", tags or "") if t.strip()][:20],
        "ext": ext,
        "src": f"/thiings/icons/{clean_slug}.{ext}",
    }
    entries.append(entry)
    _write_runtime_entries(entries)
    return JSONResponse({"ok": True, "item": entry})
