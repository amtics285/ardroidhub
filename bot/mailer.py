"""Tiny SMTP helper shared by the verification-code mail and the app status mails.

Environment: SMTP_USER, SMTP_PASS (required); SMTP_HOST (default smtp.gmail.com),
SMTP_PORT (default 465 = SSL, 587 = STARTTLS), SMTP_FROM (default SMTP_USER).
Standard library only.
"""
import os
import re
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

EMAIL_RE = re.compile(r"^[^\s@<>,;\"']+@[^\s@<>,;\"']+\.[^\s@<>,;\"']+$")


def clean_line(text: str, limit: int = 80) -> str:
    """One safe line of text for headers (no newlines or control characters)."""
    return re.sub(r"[\x00-\x1f\x7f]+", " ", str(text or "")).strip()[:limit]


def configured() -> bool:
    return bool(os.environ.get("SMTP_USER") and os.environ.get("SMTP_PASS"))


def send(to: str, subject: str, text: str, html_body: str | None = None) -> None:
    if not EMAIL_RE.match(to or "") or len(to) > 254:
        raise ValueError("bad recipient")
    user = os.environ["SMTP_USER"]
    sender = os.environ.get("SMTP_FROM") or user

    msg = EmailMessage()
    msg["From"] = formataddr(("AR DroidHub", sender))
    msg["To"] = to
    msg["Subject"] = clean_line(subject, 150)
    msg.set_content(text)
    if html_body:
        msg.add_alternative(html_body, subtype="html")

    host = os.environ.get("SMTP_HOST") or "smtp.gmail.com"
    port = int(os.environ.get("SMTP_PORT") or 465)
    ctx = ssl.create_default_context()
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=ctx, timeout=60) as s:
            s.login(user, os.environ["SMTP_PASS"])
            s.send_message(msg)
    else:
        with smtplib.SMTP(host, port, timeout=60) as s:
            s.starttls(context=ctx)
            s.login(user, os.environ["SMTP_PASS"])
            s.send_message(msg)
