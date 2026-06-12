"""gen_vapid_keys.py — one-time VAPID key pair generator.

Run once and paste the output into your .env file:
    python gen_vapid_keys.py
"""
import base64
from py_vapid import Vapid
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

v = Vapid()
v.generate_keys()

# Private key: raw 32-byte P-256 scalar → base64url (Vapid.from_string() format)
pk_int    = v._private_key.private_numbers().private_value
priv_b64  = base64.urlsafe_b64encode(pk_int.to_bytes(32, 'big')).decode().rstrip('=')

# Public key: 65-byte uncompressed EC point (0x04 || X || Y) → base64url
pub_bytes = v._public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
pub_b64   = base64.urlsafe_b64encode(pub_bytes).decode().rstrip('=')

lines = [
    "# Paste these into your .env file:",
    "",
    "BW_VAPID_PRIVATE_KEY=" + priv_b64,
    "BW_VAPID_PUBLIC_KEY=" + pub_b64,
    "BW_VAPID_SUBJECT=mailto:admin@example.com",
    "",
    "# Change BW_VAPID_SUBJECT to your admin email or your app public URL.",
]
print("\n".join(lines))
