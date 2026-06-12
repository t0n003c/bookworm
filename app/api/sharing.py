"""Sharing router — user-to-user copy + public link management + public views."""
from __future__ import annotations

import json
import re
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from pydantic import BaseModel

from templates_env import templates
from app.api.sharing_db import (
    get_public_link,
    create_public_link,
    revoke_public_link,
    get_public_link_by_token,
    search_users_for_share,
    get_or_create_shared_inbox_workspace,
    get_or_create_shared_cards_database,
    copy_note_to_workspace,
    copy_workspace_tree_to_user,
    copy_db_workspace_to_user,
    copy_db_card_to_database,
    get_note_for_public_view,
    get_db_card_for_public_view,
    note_belongs_to_user,
    workspace_belongs_to_user,
    db_card_belongs_to_user,
    get_workspace_type,
)

router = APIRouter(prefix="/share", tags=["sharing"])

# ── attribute enrichment ──────────────────────────────────────────────────────

_OPT_COLOR_IDS = {"gray","red","orange","yellow","green","teal","blue","purple","pink"}

_RT_ICON: dict[str, tuple[str, str]] = {
    "star":  ("\u2605", "\u2606"),  # ★ ☆
    "heart": ("\u2665", "\u2661"),  # ♥ ♡
    "thumb": ("\U0001f44d", "\u25cb"),  # 👍 ○
    "dot":   ("\u25cf", "\u25cb"),  # ● ○
}


def _status_css_class(val: str) -> str:
    v = (val or "").lower()
    if re.search(r"done|complete|finished|closed|resolved", v): return "green"
    if re.search(r"progress|doing|active|open|started",     v): return "blue"
    if re.search(r"block|stuck|problem|error|fail",         v): return "red"
    if re.search(r"review|pending|wait|hold",               v): return "amber"
    if re.search(r"cancel|skip|void|archive",               v): return "gray"
    return "purple"


def _parse_select_opts(opts_str: str | None) -> list[dict]:
    """Parse 'Label|colorId,...' option string into [{label, color}]."""
    if not opts_str:
        return []
    result = []
    for part in opts_str.split(","):
        part = part.strip()
        if not part:
            continue
        pipe = part.find("|")
        if pipe == -1:
            result.append({"label": part, "color": "gray"})
        else:
            lbl = part[:pipe].strip()
            clr = part[pipe + 1:].strip() or "gray"
            result.append({"label": lbl, "color": clr if clr in _OPT_COLOR_IDS else "gray"})
    return result


def _fmt_date(iso_date: str, fmt_id: str | None) -> str:
    """Format a YYYY-MM-DD string per fmt_id. Cross-platform (no %-d)."""
    try:
        d = datetime.strptime(iso_date[:10], "%Y-%m-%d")
    except (ValueError, TypeError):
        return iso_date
    fmt = fmt_id or "mdy"
    if fmt == "ymd":  return d.strftime("%Y-%m-%d")
    if fmt == "dmy":  return d.strftime("%d/%m/%Y")
    if fmt == "long": return f"{d.strftime('%B')} {d.day}, {d.year}"
    return d.strftime("%m/%d/%Y")  # 'mdy' default


def _safe_int(s: str | None, default: int = 0) -> int:
    try:
        return int(str(s or "").lstrip("-").split(".")[0])
    except (ValueError, TypeError):
        return default


def enrich_card_attrs(card: dict) -> dict:
    """Return a copy of card with each attr enriched with a '_display' dict."""
    enriched: list[dict] = []
    for a in card.get("attrs", []):
        t       = a.get("attr_type")    or "text"
        v       = a.get("attr_value")   or ""
        opts_s  = a.get("attr_options") or ""
        d: dict = {"type": t}

        if t == "checkbox":
            d["checked"] = v in ("true", "1", "yes")

        elif t == "select":
            opts  = _parse_select_opts(opts_s)
            match = next((o for o in opts if o["label"] == v), None)
            d["color"] = match["color"] if match else "gray"
            d["label"] = v

        elif t == "multi_select":
            opts      = _parse_select_opts(opts_s)
            color_map = {o["label"]: o.get("color", "gray") for o in opts}
            selected  = [s.strip() for s in v.split(",") if s.strip()]
            d["items"] = [{"label": s, "color": color_map.get(s, "gray")} for s in selected]

        elif t == "status":
            d["color_class"] = _status_css_class(v)
            d["label"]       = v

        elif t == "date":
            d["formatted"] = _fmt_date(v, opts_s) if v else ""

        elif t == "date_range":
            parts = v.split("|")
            start = parts[0].strip() if parts else ""
            end   = parts[1].strip() if len(parts) > 1 else ""
            d["start"] = _fmt_date(start, opts_s) if start else ""
            d["end"]   = _fmt_date(end,   opts_s) if end   else ""

        elif t == "rating":
            try:
                rt = json.loads(opts_s or "{}")
            except Exception:
                rt = {}
            scale   = max(1, _safe_int(rt.get("scale"), 5) or 5)
            icon_id = str(rt.get("icon") or "star")
            on_c, off_c = _RT_ICON.get(icon_id, _RT_ICON["star"])
            val_i   = min(scale, max(0, _safe_int(v)))
            d["icons"] = [
                {"char": on_c if i < val_i else off_c, "on": i < val_i}
                for i in range(scale)
            ]

        elif t == "progress":
            try:
                pg = json.loads(opts_s or "{}")
            except Exception:
                pg = {}
            max_v = max(1, _safe_int(pg.get("max"), 100) or 100)
            disp  = str(pg.get("display") or "bar")
            val_i = min(max_v, max(0, _safe_int(v)))
            pct   = round((val_i / max_v) * 100)
            d["pct"]     = pct
            d["label"]   = f"{val_i}%" if max_v == 100 else f"{val_i} / {max_v}"
            d["display"] = disp

        elif t == "url":
            fmt = opts_s or "text"
            d["href"]    = v
            d["display"] = fmt
            if v and fmt == "short":
                d["short_label"] = (
                    v.replace("https://", "").replace("http://", "").split("/")[0]
                )

        elif t == "email":
            d["href"] = f"mailto:{v}" if v else ""

        elif t == "phone":
            phones = [p.strip() for p in v.split(",") if p.strip()]
            result_phones = []
            for ph in phones:
                digits = re.sub(r"\D", "", ph)
                if len(digits) == 10:
                    tel = f"+1{digits}"
                elif len(digits) >= 11:
                    tel = f"+{digits}"
                else:
                    tel = digits or ph
                result_phones.append({"display": ph, "tel": tel})
            d["phones"] = result_phones

        elif t == "person":
            d["names"] = [n.strip().title() for n in v.split(",") if n.strip()]

        elif t == "place":
            prov = opts_s or "google"
            q    = v.replace(" ", "+")
            if prov == "apple":
                d["map_url"] = f"https://maps.apple.com/?q={q}"
            elif prov == "osm":
                d["map_url"] = f"https://www.openstreetmap.org/search?query={q}"
            else:
                d["map_url"] = f"https://maps.google.com/?q={q}"

        elif t == "number":
            try:
                num_opts = json.loads(opts_s or "{}")
            except Exception:
                num_opts = {}
            fmt  = str(num_opts.get("format")  or "number")
            decs = max(0, _safe_int(num_opts.get("decimals"), 0))
            disp = str(num_opts.get("display") or "number")
            try:
                n = float(v)
                if fmt == "percent":  formatted = f"{n:.{decs}f}%"
                elif fmt == "dollar": formatted = f"${n:,.{decs}f}"
                elif fmt == "euro":   formatted = f"\u20ac{n:,.{decs}f}"
                elif decs > 0:        formatted = f"{n:,.{decs}f}".rstrip("0").rstrip(".")
                else:                 formatted = f"{int(n):,}"
            except (ValueError, TypeError):
                formatted = v
            d["formatted"] = formatted
            if disp in ("bar", "ring"):
                div_by = float(num_opts.get("divideBy") or 100) or 100
                try:
                    frac = min(1.0, max(0.0, float(v) / div_by))
                except (ValueError, TypeError):
                    frac = 0.0
                d["pct"]     = round(frac * 100)
                d["display"] = disp
            else:
                d["display"] = "number"

        elif t == "files":
            d["links"] = [u.strip() for u in v.split(",") if u.strip()]

        attr_copy            = dict(a)
        attr_copy["render"]   = d
        enriched.append(attr_copy)

    result          = dict(card)
    result["attrs"] = enriched
    return result



# ── Demo guard helper ────────────────────────────────────────────────────────

def _is_demo(request: Request) -> bool:
    return bool(request.session.get("is_demo"))


from core.deps import session_user_id as _uid


def _base_url(request: Request) -> str:
    """Build the base URL (scheme + host) for constructing share link URLs."""
    return str(request.base_url).rstrip("/")


# ── User search ──────────────────────────────────────────────────────────────

@router.get("/users/search")
async def users_search(request: Request, q: str = ""):
    """Return up to 10 matching usernames (excluding self, demo accounts)."""
    if len(q) < 2:
        return JSONResponse([])
    results = await search_users_for_share(q.strip(), _uid(request))
    return JSONResponse(results)


# ── Share modal (HTMX partial) ───────────────────────────────────────────────

@router.get("/modal/note/{note_id}", response_class=HTMLResponse)
async def share_modal_note(request: Request, note_id: int):
    if not await note_belongs_to_user(note_id, _uid(request)):
        raise HTTPException(403, "Not your note")
    link = await get_public_link("note", note_id, _uid(request))
    share_url = f"{_base_url(request)}/share/view/note/{link['token']}" if link else None
    return templates.TemplateResponse(
        request,
        "partials/share_modal.html",
        {
            "object_type":  "note",
            "object_id":    note_id,
            "active_link":  link is not None,
            "token":        link["token"] if link else None,
            "share_url":    share_url,
        },
    )


@router.get("/modal/db-card/{card_id}", response_class=HTMLResponse)
async def share_modal_card(request: Request, card_id: int):
    if not await db_card_belongs_to_user(card_id, _uid(request)):
        raise HTTPException(403, "Not your card")
    link = await get_public_link("db_card", card_id, _uid(request))
    share_url = f"{_base_url(request)}/share/view/db-card/{link['token']}" if link else None
    return templates.TemplateResponse(
        request,
        "partials/share_modal.html",
        {
            "object_type":  "db_card",
            "object_id":    card_id,
            "active_link":  link is not None,
            "token":        link["token"] if link else None,
            "share_url":    share_url,
        },
    )


# ── Public link management ───────────────────────────────────────────────────

@router.get("/note/{note_id}/public-link")
async def get_note_public_link(request: Request, note_id: int):
    if not await note_belongs_to_user(note_id, _uid(request)):
        raise HTTPException(403, "Not your note")
    link = await get_public_link("note", note_id, _uid(request))
    url = f"{_base_url(request)}/share/view/note/{link['token']}" if link else None
    return JSONResponse({"active": link is not None, "token": link["token"] if link else None, "url": url})


@router.post("/note/{note_id}/public-link")
async def create_note_public_link(request: Request, note_id: int):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await note_belongs_to_user(note_id, _uid(request)):
        raise HTTPException(403, "Not your note")
    result = await create_public_link("note", note_id, _uid(request))
    url = f"{_base_url(request)}/share/view/note/{result['token']}"
    return JSONResponse({"token": result["token"], "url": url})


@router.delete("/note/{note_id}/public-link")
async def revoke_note_public_link(request: Request, note_id: int):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await note_belongs_to_user(note_id, _uid(request)):
        raise HTTPException(403, "Not your note")
    await revoke_public_link("note", note_id, _uid(request))
    return JSONResponse({"ok": True})


@router.get("/db-card/{card_id}/public-link")
async def get_card_public_link(request: Request, card_id: int):
    if not await db_card_belongs_to_user(card_id, _uid(request)):
        raise HTTPException(403, "Not your card")
    link = await get_public_link("db_card", card_id, _uid(request))
    url = f"{_base_url(request)}/share/view/db-card/{link['token']}" if link else None
    return JSONResponse({"active": link is not None, "token": link["token"] if link else None, "url": url})


@router.post("/db-card/{card_id}/public-link")
async def create_card_public_link(request: Request, card_id: int):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await db_card_belongs_to_user(card_id, _uid(request)):
        raise HTTPException(403, "Not your card")
    result = await create_public_link("db_card", card_id, _uid(request))
    url = f"{_base_url(request)}/share/view/db-card/{result['token']}"
    return JSONResponse({"token": result["token"], "url": url})


@router.delete("/db-card/{card_id}/public-link")
async def revoke_card_public_link(request: Request, card_id: int):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await db_card_belongs_to_user(card_id, _uid(request)):
        raise HTTPException(403, "Not your card")
    await revoke_public_link("db_card", card_id, _uid(request))
    return JSONResponse({"ok": True})


# ── User-to-user copy endpoints ──────────────────────────────────────────────

class _ToUserBody(BaseModel):
    recipient_id: int


@router.post("/note/{note_id}/to-user")
async def share_note_to_user(request: Request, note_id: int, body: _ToUserBody):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await note_belongs_to_user(note_id, _uid(request)):
        raise HTTPException(403, "Not your note")
    if body.recipient_id == _uid(request):
        raise HTTPException(400, "Cannot share with yourself")
    inbox_ws_id = await get_or_create_shared_inbox_workspace(body.recipient_id)
    await copy_note_to_workspace(note_id, inbox_ws_id)
    return JSONResponse({"ok": True, "message": "Note sent!"})


@router.post("/workspace/{ws_id}/to-user")
async def share_workspace_to_user(request: Request, ws_id: int, body: _ToUserBody):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await workspace_belongs_to_user(ws_id, _uid(request)):
        raise HTTPException(403, "Not your workspace")
    ws_type = await get_workspace_type(ws_id)
    if ws_type != "workspace":
        raise HTTPException(400, "Use the database share endpoint for database workspaces")
    if body.recipient_id == _uid(request):
        raise HTTPException(400, "Cannot share with yourself")
    await copy_workspace_tree_to_user(ws_id, body.recipient_id)
    return JSONResponse({"ok": True, "message": "Workspace copy sent!"})


@router.post("/db-workspace/{ws_id}/to-user")
async def share_db_workspace_to_user(request: Request, ws_id: int, body: _ToUserBody):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await workspace_belongs_to_user(ws_id, _uid(request)):
        raise HTTPException(403, "Not your workspace")
    ws_type = await get_workspace_type(ws_id)
    if ws_type != "database":
        raise HTTPException(400, "Not a database workspace")
    if body.recipient_id == _uid(request):
        raise HTTPException(400, "Cannot share with yourself")
    await copy_db_workspace_to_user(ws_id, body.recipient_id)
    return JSONResponse({"ok": True, "message": "Database copy sent!"})


@router.post("/db-card/{card_id}/to-user")
async def share_db_card_to_user(request: Request, card_id: int, body: _ToUserBody):
    if _is_demo(request):
        return JSONResponse({"error": "Not available in demo mode"}, status_code=403)
    if not await db_card_belongs_to_user(card_id, _uid(request)):
        raise HTTPException(403, "Not your card")
    if body.recipient_id == _uid(request):
        raise HTTPException(400, "Cannot share with yourself")
    target_db_id = await get_or_create_shared_cards_database(body.recipient_id)
    await copy_db_card_to_database(card_id, target_db_id, body.recipient_id)
    return JSONResponse({"ok": True, "message": "Card sent!"})


# ── Public view routes (no auth — middleware prefix-bypasses /share/view/) ────

@router.get("/view/note/{token}", response_class=HTMLResponse)
async def public_view_note(request: Request, token: str):
    link = await get_public_link_by_token(token)
    if not link or link["object_type"] != "note":
        return templates.TemplateResponse(
            request, "share_404.html", {}, status_code=404
        )
    note = await get_note_for_public_view(link["object_id"])
    if not note:
        return templates.TemplateResponse(
            request, "share_404.html", {}, status_code=404
        )
    return templates.TemplateResponse(
        request, "share_note_view.html", {"note": note}
    )


@router.get("/view/db-card/{token}", response_class=HTMLResponse)
async def public_view_card(request: Request, token: str):
    link = await get_public_link_by_token(token)
    if not link or link["object_type"] != "db_card":
        return templates.TemplateResponse(
            request, "share_404.html", {}, status_code=404
        )
    card = await get_db_card_for_public_view(link["object_id"])
    if not card:
        return templates.TemplateResponse(
            request, "share_404.html", {}, status_code=404
        )
    return templates.TemplateResponse(
        request, "share_card_view.html", {"card": enrich_card_attrs(card)}
    )
