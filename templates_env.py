"""Single shared Jinja2Templates instance with all custom filters.

Import `templates` from here everywhere — do NOT create new
Jinja2Templates instances in routers, that way filters are always available.

Strategy: build the Jinja2 Environment *first* (with every filter registered),
then hand it to Jinja2Templates via `env=`.  This guarantees filters exist
before *any* template is compiled, which Starlette 1.x + Jinja2 3.x require
because they validate filter names at compile-time (TemplateAssertionError).
"""
import json
import os
from datetime import date as _date
from pathlib import Path

import jinja2
from fastapi.templating import Jinja2Templates

# ── Filter helpers (must be defined before the env is created) ────────────────

def _fmt_bytes(size: int) -> str:
    """Human-readable file size e.g. 1.4 MB."""
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


def _evt_prepare_items(items: list) -> list:
    """Sort event items by their next occurrence date and attach display metadata.

    Returns a new list of dicts with extra keys:
      _idx      – original index in the source list (for evtOpenEdit / evtDelete)
      _next_iso – ISO date of the next occurrence
      _badge    – {'label': str, 'cls': str} for the countdown pill
    """
    from datetime import date as _d, timedelta
    from calendar import monthrange

    def _next(item: dict) -> str:
        target = item.get('target_date', '')
        if not target:
            return '9999-12-31'
        try:
            t     = _d.fromisoformat(target)
            today = _d.today()
            unit  = item.get('repeat_unit') or 'none'
            iv    = int(item.get('repeat_interval') or 1) or 1
            if unit == 'none' or t >= today:
                return t.isoformat()
            n = t
            for _ in range(3650):          # safety cap
                if unit == 'day':   n += timedelta(days=iv)
                elif unit == 'week': n += timedelta(weeks=iv)
                elif unit == 'month':
                    mo = n.month + iv; yr = n.year + (mo - 1) // 12; mo = (mo - 1) % 12 + 1
                    n  = _d(yr, mo, min(n.day, monthrange(yr, mo)[1]))
                elif unit == 'year':
                    n = _d(n.year + iv, n.month, n.day)
                else:
                    break
                if n >= today:
                    break
            return n.isoformat()
        except Exception:
            return target

    def _badge(next_iso: str) -> dict:
        try:
            days = (_d.fromisoformat(next_iso) - _d.today()).days
        except Exception:
            return {'label': '?', 'cls': 'bg-gray-100 text-gray-400 dark:bg-zinc-800'}
        if days == 0:
            return {'label': '\U0001f389 Today',
                    'cls': 'bg-green-100 text-wgreen dark:bg-green-900/30'}
        if days < 0:
            return {'label': f'{-days}d ago',
                    'cls': 'bg-gray-100 text-gray-500 dark:bg-zinc-800'}
        if days == 1:
            return {'label': 'Tomorrow',
                    'cls': 'bg-red-100 text-wred dark:bg-red-900/30'}
        if days <= 3:
            return {'label': f'{days}d',
                    'cls': 'bg-red-100 text-wred dark:bg-red-900/30'}
        if days <= 7:
            return {'label': f'{days}d',
                    'cls': 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30'}
        return {'label': f'{days}d',
                'cls': 'bg-blue-50 text-wblue dark:bg-wblue/10'}

    _REPEAT_PRESETS = {
        'none':    '',     'day:1':   'Daily',
        'week:1':  'Weekly',  'week:2': 'Every 2 weeks',
        'week:3':  'Every 3 weeks', 'month:1': 'Monthly',
        'month:3': 'Quarterly',    'year:1':  'Yearly',
    }

    def _repeat_label(item: dict) -> str:
        u  = item.get('repeat_unit') or 'none'
        iv = int(item.get('repeat_interval') or 1)
        if u == 'none':
            return ''
        key = f'{u}:{iv}'
        if key in _REPEAT_PRESETS:
            return _REPEAT_PRESETS[key]
        return f'Every {iv} {u}(s)'

    def _fmt_date_str(iso: str) -> str:
        try:
            d = _d.fromisoformat(iso)
            day = str(d.day)  # no leading zero
            return d.strftime('%b ') + day + ', ' + str(d.year)
        except Exception:
            return iso

    enriched = []
    for idx, item in enumerate(items):
        nxt = _next(item)
        enriched.append({**item, '_idx': idx, '_next_iso': nxt,
                         '_badge': _badge(nxt), '_repeat': _repeat_label(item),
                         '_date_str': _fmt_date_str(nxt)})
    return sorted(enriched, key=lambda x: x['_next_iso'])


def _fmt_reminder_date(iso: str) -> str:
    """'2025-01-06' → 'Today', 'Tomorrow', or 'Jan 6'."""
    if not iso:
        return ""
    try:
        d     = _date.fromisoformat(iso)
        today = _date.today()
        delta = (d - today).days
        if delta == 0:  return "Today"
        if delta == 1:  return "Tomorrow"
        if delta == -1: return "Yesterday"
        day = int(d.strftime("%d"))  # no zero-padding cross-platform
        return d.strftime("%b ") + str(day)
    except ValueError:
        return iso


def _sort_reminders(items: list) -> list:
    """Sort reminder items by date then time (missing date sorts first)."""
    return sorted(
        items,
        key=lambda x: (x.get("date", "") or "", x.get("time", "") or ""),
    )


def _tojson(v: object, indent: int | None = None) -> str:
    return json.dumps(v, default=str, indent=indent)


def _local_dt(utc_str: str) -> "datetime":
    """Parse a SQLite UTC datetime string and return a local-tz aware datetime.

    SQLite CURRENT_TIMESTAMP format: '2025-04-07 22:19:33'
    Also handles ISO-8601 with T separator and optional +00:00 suffix.
    """
    from datetime import datetime, timezone
    if not utc_str:
        return None
    try:
        normalised = utc_str.replace(' ', 'T')
        if not normalised.endswith(('+00:00', 'Z')) and '+' not in normalised[10:]:
            normalised += '+00:00'          # tell Python it is UTC
        dt_utc = datetime.fromisoformat(normalised)
        return dt_utc.astimezone()          # convert to server local timezone
    except Exception:
        return None


def _local_time(utc_str: str) -> str:
    """'2025-04-07 22:19:33' (UTC)  →  '6:19 PM' (local)."""
    dt = _local_dt(utc_str)
    if dt is None:
        return utc_str[11:16] if utc_str and len(utc_str) > 15 else (utc_str or '—')
    return dt.strftime('%I:%M %p').lstrip('0') or '12:00 AM'


def _local_date(utc_str: str) -> str:
    """'2025-04-07 22:19:33' (UTC)  →  '2025-04-07' (local date)."""
    dt = _local_dt(utc_str)
    if dt is None:
        return utc_str[:10] if utc_str else '—'
    return dt.strftime('%Y-%m-%d')


def _static_version() -> str:
    """Cache-busting string — changes on every server restart.

    Previously used max mtime of static files, but that silently returns
    the default "0" on Windows/OneDrive paths where rglob may yield nothing,
    meaning the browser caches assets forever across restarts.

    Strategy: use current epoch seconds at startup (always unique per process)
    combined with the mtime of key files as a tiebreaker, so a restart always
    busts the cache even if the clock hasn't ticked.
    """
    import time
    base = int(time.time())
    static_dir = Path(__file__).parent / "static"
    try:
        # Try to get a file-based component as well (belt-and-suspenders)
        key_files = [
            static_dir / "js" / "home-widget-text.js",
            static_dir / "js" / "home-widgets.js",
        ]
        extra = max(
            (int(f.stat().st_mtime) for f in key_files if f.exists()),
            default=0,
        )
        return str(base + extra % 10000)
    except Exception:
        return str(base)


# ── Build the Jinja2 env with all filters registered *before* any template
#    compilation can happen.  Starlette 1.x validates filter names at
#    compile-time, so filters MUST be present on the env at that moment. ────────

_jinja_env = jinja2.Environment(
    loader=jinja2.FileSystemLoader("templates"),
    autoescape=jinja2.select_autoescape(["html", "xml"]),
)

_jinja_env.filters["fmt_bytes"]          = _fmt_bytes
_jinja_env.filters["tojson"]             = _tojson
_jinja_env.filters["fmt_reminder_date"]  = _fmt_reminder_date
_jinja_env.filters["sort_reminders"]     = _sort_reminders
_jinja_env.filters["evt_prepare_items"]  = _evt_prepare_items
_jinja_env.filters["local_time"]         = _local_time
_jinja_env.filters["local_date"]         = _local_date

_jinja_env.globals["static_v"] = _static_version()
static_v: str = _jinja_env.globals["static_v"]   # re-exported so main.py can inject it into sw.js
_jinja_env.globals["bw_max_upload_mb"] = int(os.getenv("BW_MAX_UPLOAD_MB", "200"))
_jinja_env.globals["bw_vapid_public_key"] = os.getenv("BW_VAPID_PUBLIC_KEY", "")

# ── Expose as Jinja2Templates so all routers can call TemplateResponse ────────
templates = Jinja2Templates(env=_jinja_env)








