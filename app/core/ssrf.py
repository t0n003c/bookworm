"""bw_ssrf.py — shared Server-Side Request Forgery guard.

Any feature that fetches a user-supplied URL server-side (RSS reader, article
reader, image proxy, link-title preview, tutorial auto-fetch) must validate the
target before connecting, AND re-validate every redirect hop — otherwise a
logged-in user can make the server read internal services or the cloud metadata
endpoint (169.254.169.254).

Usage:
    if not is_safe_url(url):
        reject
    # for redirect-following fetches, validate each hop's Location too.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse, urljoin


def is_public_host(host: str) -> bool:
    """True only when EVERY address `host` resolves to is a routable public IP.

    Rejecting on *any* private address closes the DNS-rebinding window where a
    name resolves to both a public and a private IP.
    """
    if not host:
        return False
    try:
        infos = socket.getaddrinfo(host, None)
    except Exception:
        return False
    if not infos:
        return False
    for *_rest, sockaddr in infos:
        try:
            ip = ipaddress.ip_address(sockaddr[0])
        except ValueError:
            return False
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            return False
    return True


def is_safe_url(raw_url: str) -> bool:
    """http(s) scheme + a hostname that resolves only to public IPs."""
    try:
        p = urlparse(raw_url)
        if p.scheme not in ("http", "https"):
            return False
        return is_public_host(p.hostname or "")
    except Exception:
        return False


def resolve_redirect(base_url: str, location: str) -> str | None:
    """Resolve a (possibly relative) redirect Location against base_url and
    return it only if the resulting absolute URL is SSRF-safe, else None."""
    try:
        target = urljoin(base_url, location)
    except Exception:
        return None
    return target if is_safe_url(target) else None
