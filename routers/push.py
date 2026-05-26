"""push.py — Web Push API endpoints.

Routes (all public-path, no /home prefix):
  GET  /push/public-key          — returns VAPID public key for the client
  POST /push/subscribe           — save a PushSubscription for the current user
  POST /push/unsubscribe         — remove a PushSubscription by endpoint
  POST /push/test                — send a test notification to the current user
"""
import logging
import os

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from routers.push_db import (
    delete_subscription,
    get_user_subscriptions,
    has_subscription,
    save_subscription,
    send_push,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/push")

_VAPID_PUBLIC_KEY = os.getenv("BW_VAPID_PUBLIC_KEY", "")


def _uid(req: Request) -> int:
    uid = req.session.get("user_id")
    if not uid:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return uid


# ── VAPID public key — served to every client, no auth required ───────────────

@router.get("/public-key")
async def vapid_public_key():
    """Return the VAPID public key so the client can subscribe."""
    if not _VAPID_PUBLIC_KEY:
        raise HTTPException(status_code=503, detail="Push not configured")
    return JSONResponse({"publicKey": _VAPID_PUBLIC_KEY})


# ── Subscription management ───────────────────────────────────────────────────

@router.post("/subscribe")
async def push_subscribe(request: Request):
    """Save a PushSubscription for the authenticated user."""
    try:
        uid  = _uid(request)
        body = await request.json()
        endpoint = str(body.get("endpoint", "")).strip()
        keys     = body.get("keys", {}) or {}
        p256dh   = str(keys.get("p256dh", "")).strip()
        auth_key = str(keys.get("auth", "")).strip()
        ua       = request.headers.get("User-Agent", "")[:200]

        if not endpoint or not p256dh or not auth_key:
            return JSONResponse({"error": "missing fields"}, status_code=400)

        sid = await save_subscription(uid, endpoint, p256dh, auth_key, ua)
        return JSONResponse({"ok": True, "id": sid})
    except HTTPException:
        raise
    except Exception:
        log.exception("push_subscribe")
        return JSONResponse({"error": "server error"}, status_code=500)


@router.post("/unsubscribe")
async def push_unsubscribe(request: Request):
    """Remove a PushSubscription by endpoint."""
    try:
        _uid(request)  # must be logged in
        body     = await request.json()
        endpoint = str(body.get("endpoint", "")).strip()
        if not endpoint:
            return JSONResponse({"error": "missing endpoint"}, status_code=400)
        ok = await delete_subscription(endpoint)
        return JSONResponse({"ok": ok})
    except HTTPException:
        raise
    except Exception:
        log.exception("push_unsubscribe")
        return JSONResponse({"error": "server error"}, status_code=500)


@router.get("/status")
async def push_status(request: Request):
    """Return whether this user has any push subscriptions saved."""
    try:
        uid = _uid(request)
        return JSONResponse({"subscribed": await has_subscription(uid)})
    except HTTPException:
        raise
    except Exception:
        log.exception("push_status")
        return JSONResponse({"error": "server error"}, status_code=500)


@router.post("/test")
async def push_test(request: Request):
    """Send a test notification to all of the current user's subscriptions."""
    try:
        uid  = _uid(request)
        subs = await get_user_subscriptions(uid)
        if not subs:
            return JSONResponse({"ok": False, "error": "no subscriptions"})

        payload = {
            "title": "📚 BookWorm",
            "body":  "Test notification — push is working!",
            "icon":  "/static/img/icons/icon-192.png",
            "badge": "/static/img/icons/icon-192.png",
            "tag":   "bw-test",
        }
        sent = 0
        stale: list[str] = []
        for sub in subs:
            sub_info = {"endpoint": sub["endpoint"],
                        "keys":     {"p256dh": sub["p256dh"], "auth": sub["auth"]}}
            result = await send_push(sub_info, payload)
            if result is True:
                sent += 1
            elif result is None:
                stale.append(sub["endpoint"])

        # Clean up expired endpoints
        for ep in stale:
            await delete_subscription(ep)

        return JSONResponse({"ok": True, "sent": sent, "stale_removed": len(stale)})
    except HTTPException:
        raise
    except Exception:
        log.exception("push_test")
        return JSONResponse({"error": "server error"}, status_code=500)
