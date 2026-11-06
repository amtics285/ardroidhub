"""Sends the 6-digit verification code by email.

The Worker passes the recipient + code as an AES-GCM encrypted workflow input (the repo is
public, so plain inputs would be visible to everybody). The code and address are never printed.
"""
import base64
import json
import os
import re
import smtplib
import ssl
import sys
import time
from email.message import EmailMessage
from email.utils import formataddr

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

EMAIL_RE = re.compile(r"^[^\s@<>,;\"']+@[^\s@<>,;\"']+\.[^\s@<>,;\"']+$")
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
    user = os.environ["SMTP_USER"]

    msg = EmailMessage()
    msg["From"] = formataddr(("AR DroidHub", user))
    msg["To"] = to
    msg["Subject"] = f"{code} is your AR DroidHub verification code"
    msg.set_content(
        f"{greeting}\n\n"
        f"Your AR DroidHub verification code is:\n\n    {code}\n\n"
        "Enter it on the website to verify your email address. "
        "The code works for at least 10 minutes.\n\n"
        "If you did not create an AR DroidHub account, you can ignore this email.\n"
    )

    host = os.environ.get("SMTP_HOST") or "smtp.gmail.com"
    port = int(os.environ.get("SMTP_PORT") or 465)
    with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=60) as s:
        s.login(user, os.environ["SMTP_PASS"])
        s.send_message(msg)
    print("Verification email sent.")


if __name__ == "__main__":
    main()
