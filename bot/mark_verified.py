"""Marks a Firebase user's email as verified. Only the Worker starts this, after it checked the code."""
import os
import re
import sys

from common import init_firestore

UID_RE = re.compile(r"^[A-Za-z0-9]{20,40}$")


def main():
    uid = os.environ.get("TARGET_UID", "")
    if not UID_RE.match(uid):
        sys.exit("Invalid uid")
    init_firestore()  # initialises the Admin SDK app
    from firebase_admin import auth

    user = auth.get_user(uid)
    if user.email_verified:
        print("Already verified.")
        return
    if not user.email:
        sys.exit("User has no email address")
    auth.update_user(uid, email_verified=True)
    print("Email marked as verified.")


if __name__ == "__main__":
    main()
