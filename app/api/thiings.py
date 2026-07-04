"""Thiings icon library endpoints.

Runtime-uploaded Thiings icons live under BW_DATA_DIR so users can add icons
from the app UI without editing the source tree. Bundled/static icons remain
supported through static/data/thiings-icons.json and static/img/thiings.
"""
from __future__ import annotations

import json
import logging
import os
import re
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from app.core.db import DATA_DIR
from core.deps import current_user_id

router = APIRouter(prefix="/thiings", tags=["thiings"])
log = logging.getLogger(__name__)

_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,90}$")
_MAX_ICON_BYTES = 2 * 1024 * 1024
_MAX_ZIP_BYTES = 500 * 1024 * 1024
_MAX_ZIP_UNCOMPRESSED = 2 * 1024 * 1024 * 1024
_MAX_BULK_ICONS = 12000
_IMAGE_EXTS = {"png", "jpg", "jpeg", "gif", "webp"}
_DATA_DIR = DATA_DIR / "thiings"
_ICON_DIR = _DATA_DIR / "icons"
_IMPORT_DIR = _DATA_DIR / "imports"
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


def _ext_from_name(name: str) -> str:
    ext = Path(name).suffix.lower().lstrip(".")
    return "jpg" if ext == "jpeg" else ext


def _load_json(path: Path) -> list[dict]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return []
    return data if isinstance(data, list) else []


def _tags_from_value(value: object) -> list[str]:
    if isinstance(value, str):
        return [t.strip() for t in re.split(r"[,;/| ]+", value) if t.strip()]
    if isinstance(value, list):
        return [str(t).strip() for t in value if str(t).strip()]
    return []


def _clean_entry(entry: dict, runtime: bool) -> dict | None:
    slug = _slugify(str(entry.get("slug") or entry.get("id") or ""))
    if not slug or not _SLUG_RE.match(slug):
        return None
    name = str(entry.get("name") or slug.replace("-", " ")).strip()[:120]
    tags = _tags_from_value(entry.get("tags") or [])
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


def _walk_metadata(obj: object) -> list[dict]:
    """Extract likely icon metadata dicts from unknown Thiings JSON shapes."""
    out: list[dict] = []
    if isinstance(obj, list):
        for item in obj:
            out.extend(_walk_metadata(item))
    elif isinstance(obj, dict):
        nameish = obj.get("name") or obj.get("title") or obj.get("slug") or obj.get("id")
        has_tags = any(k in obj for k in ("tags", "keywords", "categories", "category"))
        fileish = obj.get("file") or obj.get("filename") or obj.get("path") or obj.get("src")
        if nameish or has_tags or fileish:
            out.append(obj)
        for key in ("items", "icons", "things", "data", "results"):
            if key in obj:
                out.extend(_walk_metadata(obj[key]))
    return out


def _metadata_indexes(zipf: zipfile.ZipFile) -> tuple[dict[str, dict], dict[str, dict]]:
    by_slug: dict[str, dict] = {}
    by_stem: dict[str, dict] = {}
    for info in zipf.infolist():
        if info.is_dir() or _ext_from_name(info.filename) != "json" or info.file_size > 20 * 1024 * 1024:
            continue
        try:
            data = json.loads(zipf.read(info).decode("utf-8", errors="replace"))
        except (json.JSONDecodeError, UnicodeDecodeError, OSError, zipfile.BadZipFile):
            continue
        for raw in _walk_metadata(data):
            name = str(raw.get("name") or raw.get("title") or raw.get("slug") or raw.get("id") or "").strip()
            slug = _slugify(str(raw.get("slug") or raw.get("id") or name))
            file_ref = str(raw.get("file") or raw.get("filename") or raw.get("path") or raw.get("src") or "").strip()
            stem = _slugify(Path(file_ref).stem) if file_ref else ""
            tags = []
            for key in ("tags", "keywords", "categories", "category"):
                tags.extend(_tags_from_value(raw.get(key)))
            entry = {"slug": slug, "name": name, "tags": tags[:40]}
            if slug:
                by_slug[slug] = entry
            if stem:
                by_stem[stem] = entry
    return by_slug, by_stem


def _entry_for_zip_image(filename: str, ext: str, meta: dict | None) -> dict:
    fallback_stem = _slugify(Path(filename).stem)
    slug = _slugify(str((meta or {}).get("slug") or fallback_stem))
    name = str((meta or {}).get("name") or Path(filename).stem.replace("-", " ").replace("_", " ")).strip()
    return {
        "slug": slug,
        "name": name[:120] or slug.replace("-", " ").title(),
        "tags": _tags_from_value((meta or {}).get("tags") or [])[:20],
        "ext": ext,
        "src": f"/thiings/icons/{slug}.{ext}",
    }


def _is_zip_image(info: zipfile.ZipInfo) -> bool:
    if info.is_dir():
        return False
    parts = Path(info.filename).parts
    if not parts:
        return False
    if any(p.startswith(".") or p == "__MACOSX" for p in parts):
        return False
    return _ext_from_name(info.filename) in _IMAGE_EXTS


def _zip_image_infos(infos: list[zipfile.ZipInfo]) -> tuple[list[zipfile.ZipInfo], int]:
    """Return importable image entries, deduped by slug stem.

    Some icon packs include duplicate folders, OS resource files, or multiple
    image formats for the same icon. Count unique slugs for the safety cap.
    """
    by_slug: dict[str, zipfile.ZipInfo] = {}
    raw_count = 0
    for info in infos:
        if not _is_zip_image(info):
            continue
        raw_count += 1
        slug = _slugify(Path(info.filename).stem)
        if not slug:
            continue
        existing = by_slug.get(slug)
        if existing is None or info.file_size > existing.file_size:
            by_slug[slug] = info
    return list(by_slug.values()), raw_count


def _import_zip_obj(zip_obj) -> dict:
    """Import icons from a ZIP file-like object."""
    with zipfile.ZipFile(zip_obj) as zipf:
        infos = [i for i in zipf.infolist() if not i.is_dir()]
        total_compressed = sum(max(0, i.compress_size) for i in infos)
        total_uncompressed = sum(max(0, i.file_size) for i in infos)
        if total_compressed > _MAX_ZIP_BYTES or total_uncompressed > _MAX_ZIP_UNCOMPRESSED:
            return {"error": "ZIP is too large to import.", "status": 400}

        image_infos, raw_image_count = _zip_image_infos(infos)
        if not image_infos:
            return {"error": "No supported image files found in the ZIP.", "status": 400}
        if len(image_infos) > _MAX_BULK_ICONS:
            return {
                "error": f"ZIP has too many unique icons ({len(image_infos)}). Limit is {_MAX_BULK_ICONS}.",
                "status": 400,
            }

        by_slug, by_stem = _metadata_indexes(zipf)
        existing = {e["slug"]: e for e in _runtime_entries()}
        imported = 0
        skipped = 0
        _ICON_DIR.mkdir(parents=True, exist_ok=True)

        for info in image_infos:
            if info.file_size > _MAX_ICON_BYTES:
                skipped += 1
                continue
            stem_slug = _slugify(Path(info.filename).stem)
            meta = by_stem.get(stem_slug) or by_slug.get(stem_slug)
            raw = zipf.read(info)
            kind = _icon_kind(raw)
            if not kind:
                skipped += 1
                continue
            real_ext = kind[0]
            entry = _entry_for_zip_image(info.filename, real_ext, meta)
            if not entry["slug"]:
                skipped += 1
                continue
            (_ICON_DIR / f"{entry['slug']}.{real_ext}").write_bytes(raw)
            existing[entry["slug"]] = entry
            imported += 1

        _write_runtime_entries(list(existing.values()))
    deduped = max(0, raw_image_count - len(image_infos))
    return {"ok": True, "imported": imported, "skipped": skipped, "deduped": deduped}


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


@router.post("/bulk-upload")
async def bulk_upload_thiings(
    request: Request,
    file: UploadFile = File(...),
):
    """Import a licensed Thiings ZIP pack and build the runtime manifest."""
    current_user_id(request, detail=None)
    if guard := _demo_guard(request):
        return guard

    if getattr(file, "size", None) and file.size > _MAX_ZIP_BYTES:
        return JSONResponse({"error": "ZIP must be 500 MB or smaller."}, status_code=400)
    await file.seek(0)
    try:
        result = _import_zip_obj(file.file)
    except zipfile.BadZipFile:
        return JSONResponse({"error": "That file is not a valid ZIP."}, status_code=400)
    finally:
        await file.close()

    if result.get("error"):
        return JSONResponse({"error": result["error"]}, status_code=int(result.get("status") or 400))
    return JSONResponse(result)


@router.get("/server-zips")
async def list_server_thiings_zips(request: Request):
    """List ZIP files copied into BW_DATA_DIR/thiings/imports."""
    current_user_id(request, detail=None)
    _IMPORT_DIR.mkdir(parents=True, exist_ok=True)
    zips = []
    for path in sorted(_IMPORT_DIR.glob("*.zip"), key=lambda p: p.name.lower()):
        try:
            stat = path.stat()
        except OSError:
            continue
        zips.append({"name": path.name, "size": stat.st_size, "readable": os.access(path, os.R_OK)})
    return JSONResponse({
        "ok": True,
        "dir": str(_IMPORT_DIR),
        "zips": zips,
    })


@router.post("/server-import")
async def import_server_thiings_zip(
    request: Request,
    filename: str = Form(...),
):
    """Import a ZIP already present on the server/NAS data volume."""
    current_user_id(request, detail=None)
    if guard := _demo_guard(request):
        return guard

    clean_name = Path(filename).name
    if clean_name != filename or not clean_name.lower().endswith(".zip"):
        return JSONResponse({"error": "Choose a ZIP from the imports folder."}, status_code=400)
    path = _IMPORT_DIR / clean_name
    if not path.exists() or not path.is_file():
        return JSONResponse({"error": "ZIP was not found in the imports folder."}, status_code=404)
    if path.stat().st_size > _MAX_ZIP_BYTES:
        return JSONResponse({"error": "ZIP must be 500 MB or smaller."}, status_code=400)

    try:
        with path.open("rb") as fh:
            result = _import_zip_obj(fh)
    except zipfile.BadZipFile:
        return JSONResponse({"error": "That file is not a valid ZIP."}, status_code=400)
    except OSError as exc:
        reason = getattr(exc, "strerror", None) or exc.__class__.__name__
        return JSONResponse({
            "error": f"BookWorm could not read that ZIP file: {reason}. Check file permissions in the imports folder.",
        }, status_code=400)
    except Exception as exc:
        log.exception("Thiings server ZIP import failed for %s", clean_name)
        return JSONResponse({
            "error": f"Thiings import crashed: {exc.__class__.__name__}. Check the BookWorm container logs for details.",
        }, status_code=500)

    if result.get("error"):
        return JSONResponse({"error": result["error"]}, status_code=int(result.get("status") or 400))
    result["filename"] = clean_name
    return JSONResponse(result)
