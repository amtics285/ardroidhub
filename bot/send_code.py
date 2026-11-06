"""Sends the 6-digit verification code by email.

The Worker passes the recipient + code as an AES-GCM encrypted workflow input (the repo is
public, so plain inputs would be visible to everybody). The code and address are never printed.
"""
import base64
import json
import os
import re
import sys
import time

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

import mailer

EMAIL_RE = mailer.EMAIL_RE
MAX_AGE_MS = 15 * 60 * 1000


def b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def decrypt(payload: str, key_b64: str) -> dict:
    key = base64.b64decode(key_b64.strip())
    if len(key) != 32:
        sys.exit("MAIL_KEY must be 32 bytes (base64)")
    raw = b64url_decode(payload.strip())
    return json.loads(AESGCM(key).decrypt(raw[:12], raw[12:], None))


def main():
    data = decrypt(os.environ["PAYLOAD"], os.environ["MAIL_KEY"])
    to, code = str(data.get("to", "")), str(data.get("code", ""))
    if not EMAIL_RE.match(to) or len(to) > 254:
        sys.exit("Bad recipient")
    if not re.fullmatch(r"\d{6}", code):
        sys.exit("Bad code")
    if time.time() * 1000 - float(data.get("ts", 0)) > MAX_AGE_MS:
        sys.exit("Request is too old, not sending")

    name = re.sub(r"[^\w .-]", "", str(data.get("name", "")))[:40].strip()
    greeting = f"Hi {name}," if name else "Hi,"
    text = (
        f"{greeting}\n\n"
        f"Your AR DroidHub verification code is:\n\n    {code}\n\n"
        "Enter it on the website to verify your email address. "
        "The code works for at least 10 minutes.\n\n"
        "If you did not create an AR DroidHub account, you can ignore this email.\n"
    )
    page = (
        '<div style="background:#f6f8f9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1f2328">'
        '<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e1e5e9;border-radius:14px;overflow:hidden">'
        '<div style="background:#01875f;color:#fff;padding:18px 24px;font-size:18px;font-weight:700">Verify your email</div>'
        f'<div style="padding:24px"><p style="margin:0 0 14px">{greeting}</p>'
        '<p style="margin:0 0 14px">Your AR DroidHub verification code is:</p>'
        f'<p style="margin:0 0 18px;font-size:34px;letter-spacing:8px;font-weight:700;color:#016b4c">{code}</p>'
        '<p style="margin:0 0 10px;color:#5f6872;font-size:14px">Enter it on the website. The code works for at least 10 minutes.</p>'
        '<p style="margin:0;color:#5f6872;font-size:14px">If you did not create an AR DroidHub account, ignore this email.</p>'
        "</div></div></div>"
    )
    mailer.send(to, f"{code} is your AR DroidHub verification code", text, page)
    print("Verification email sent.")


if __name__ == "__main__":
    main()
