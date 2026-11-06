"""Status emails for developers: received, published, rejected.

Mails go ONLY to the email address of the Firebase account that owns the app (never to the
free-text "contact email" field, which anyone could point at a stranger). A mail problem must
never break a review run, so every failure is swallowed and only a generic line is printed.
"""
import html as htmllib
import os

import mailer

BRAND = "#01875f"


def site_url() -> str:
    url = os.environ.get("SITE_URL")
    if url:
        return url.rstrip("/") + "/"
    owner, _, repo = os.environ.get("GITHUB_REPOSITORY", "/").partition("/")
    return f"https://{owner}.github.io/{repo}/"


def compose(kind: str, app_name: str, app_id: str, reason: str = "", dev_name: str = ""):
    """Return (subject, plain text, html) for one status mail."""
    name = mailer.clean_line(app_name, 50) or "your app"
    base = site_url()
    dashboard = base + "#/dashboard"
    app_link = f"{base}#/app/{app_id}"
    reason = (reason or "").strip()[:500]
    hello = f"Hi {mailer.clean_line(dev_name, 40)}," if dev_name else "Hi,"

    if kind == "received":
        subject = f"We received {name}"
        title, color = "Your app is in the queue", "#1a56db"
        lines = [
            f"We received {name} and started the review.",
            "This usually takes a few minutes. You can follow every step on your dashboard, and we will email you again as soon as there is a result.",
        ]
        link, label = dashboard, "Track status"
    elif kind == "approved":
        subject = f"{name} is live on AR DroidHub"
        title, color = "Your app is published", BRAND
        lines = [f"Good news! {name} passed all checks and is now live on AR DroidHub. Anyone can install it now."]
        link, label = app_link, "View your app"
    elif kind == "rejected":
        subject = f"{name} was rejected"
        title, color = "Your app was rejected", "#c5221f"
        lines = [f"{name} could not be published."]
        if reason:
            lines.append(f"Reason: {reason}")
        lines.append("You can fix the problem and submit the app again from your dashboard.")
        link, label = dashboard, "Open dashboard"
    else:
        raise ValueError("unknown kind")

    text = hello + "\n\n" + "\n\n".join(lines) + f"\n\n{label}: {link}\n\n- AR DroidHub\n"
    body = "".join(f'<p style="margin:0 0 14px;line-height:1.5">{htmllib.escape(x)}</p>' for x in lines)
    page = (
        '<div style="background:#f6f8f9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1f2328">'
        '<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e1e5e9;border-radius:14px;overflow:hidden">'
        f'<div style="background:{color};color:#fff;padding:18px 24px;font-size:18px;font-weight:700">'
        f'<img src="{base}img/logo-64.png" width="28" height="28" alt="" style="vertical-align:middle;border-radius:50%;margin-right:10px">{htmllib.escape(title)}</div>'
        f'<div style="padding:24px"><p style="margin:0 0 14px">{htmllib.escape(hello)}</p>{body}'
        f'<p style="margin:22px 0"><a href="{htmllib.escape(link, quote=True)}" '
        f'style="background:{BRAND};color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:700;display:inline-block">'
        f"{htmllib.escape(label)}</a></p>"
        '<p style="margin:0;color:#5f6872;font-size:13px">AR DroidHub</p></div></div></div>'
    )
    return subject, text, page


def notify(db, app_id: str, kind: str, reason: str = "") -> None:
    """Send one status mail to the owner of `app_id`. Never raises."""
    try:
        if not mailer.configured():
            print("Status mail skipped (SMTP is not configured).")
            return
        from firebase_admin import auth

        doc = db.collection("apps").document(app_id).get().to_dict() or {}
        owner = doc.get("ownerUid")
        if not owner:
            return
        user = auth.get_user(owner)
        if not user.email or not user.email_verified:
            print("Status mail skipped (owner has no verified email).")
            return
        subject, text, page = compose(kind, doc.get("name", ""), app_id, reason, doc.get("developerName", ""))
        mailer.send(user.email, subject, text, page)
        print(f"Status mail sent ({kind}).")
    except Exception as e:  # noqa: BLE001 - mail is best effort
        print(f"Status mail failed ({kind}): {type(e).__name__}")
