"""Quick-Ask PWA overlay — standalone AI search page.

Renders a minimal fullscreen page (no sidebar, no full app chrome) so users
can ask questions directly from the Android home screen shortcut without
booting the full BookWorm SPA.

Auth is enforced by the existing middleware — unauthenticated requests are
redirected to /login?next=/quick-ask[?q=…] and the question survives the
round-trip.
"""
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from templates_env import templates

router = APIRouter(tags=["quick-ask"])


@router.get("/quick-ask", response_class=HTMLResponse, include_in_schema=False)
async def quick_ask_page(request: Request, q: str = ""):
    """Standalone PWA AI search overlay.

    q — optional pre-filled question (used by Web Share Target and the
        manifest shortcut; auth-gated via middleware).
    """
    return templates.TemplateResponse(request, "quick_ask.html", {"q": q})
