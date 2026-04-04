"""Single shared Jinja2Templates instance with all custom filters.

Import `templates` from here everywhere — do NOT create new
Jinja2Templates instances in routers, that way filters are always available.
"""
import json
from fastapi.templating import Jinja2Templates

templates = Jinja2Templates(directory="templates")


def _fmt_bytes(size: int) -> str:
    """Human-readable file size  e.g. 1.4 MB."""
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024:
            return f"{size:.0f} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} TB"


templates.env.filters["fmt_bytes"] = _fmt_bytes
templates.env.filters["tojson"]    = lambda v, indent=None: json.dumps(v, default=str, indent=indent)