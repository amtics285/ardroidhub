# python3 tests/notify_test.py  - builds the status mails and sends them through a fake SMTP server
import os, sys, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bot"))
os.environ.update(SMTP_USER="bot@example.com", SMTP_PASS="x", GITHUB_REPOSITORY="amtics285/ardroidhub")
import mailer, notify

sent = []
class FakeSMTP:
    def __init__(self, *a, **k): self.started = False
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def starttls(self, **k): sent.append("starttls")
    def login(self, u, p): assert (u, p) == ("bot@example.com", "x")
    def send_message(self, m): sent.append(m)
mailer.smtplib.SMTP_SSL = FakeSMTP
mailer.smtplib.SMTP = FakeSMTP

evil = "<b>Evil</b>\r\nBcc: x@y.z"
for kind in ["received", "approved", "rejected"]:
    subj, text, page = notify.compose(kind, evil, "abc1234567", "bad <script>alert(1)</script>", "Dev <x>")
    assert "\n" not in subj and "\r" not in subj, subj
    assert "<script>" not in page and "<b>Evil" not in page
    assert "https://amtics285.github.io/ardroidhub/#/" in text
    mailer.send("dev@example.com", subj, text, page)
    m = sent.pop()
    assert m["To"] == "dev@example.com" and m["Bcc"] is None
    assert m.get_body(("html",)) is not None
assert "bad <script>" in notify.compose("rejected", "A", "abc1234567", "bad <script>alert(1)</script>")[1]  # plain text keeps it as text
os.environ["SMTP_PORT"] = "587"; mailer.send("dev@example.com", "s", "t"); assert sent[0] == "starttls"; sent.clear()
try: mailer.send("not-an-email", "s", "t"); raise SystemExit("bad recipient accepted")
except ValueError: pass

# notify() never raises, and skips without SMTP settings
del os.environ["SMTP_USER"]; notify.notify(object(), "abc1234567", "approved")
os.environ["SMTP_USER"] = "bot@example.com"; notify.notify(object(), "abc1234567", "approved")
print("notify tests passed")
