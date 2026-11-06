"""Shared helpers for the AR DroidHub review bot."""
import json
import os
import re
import sys

import requests

API = "https://api.github.com"
APP_ID_RE = re.compile(r"^[A-Za-z0-9]{10,40}$")
# The only file names the bot will ever accept from the draft release.
ASSET_RE = re.compile(r"^(icon\.(png|jpg)|ss[1-8]\.(png|jpg)|app\.apk)$")
WORK = "work"


def get_app_id() -> str:
    app_id = os.environ.get("APP_ID", "")
    if not APP_ID_RE.match(app_id):
        sys.exit("Invalid APP_ID")
    return app_id


def repo() -> str:
    return os.environ["GITHUB_REPOSITORY"]


def gh_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "Authorization": "Bearer " + os.environ["GH_TOKEN"],
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "ardroidhub-bot",
        }
    )
    return s


def find_draft(s: requests.Session, app_id: str):
    name = "pending-" + app_id
    for page in range(1, 6):
        r = s.get(f"{API}/repos/{repo()}/releases", params={"per_page": 100, "page": page}, timeout=60)
        r.raise_for_status()
        items = r.json()
        for rel in items:
            if rel.get("draft") and rel.get("name") == name:
                return rel
        if len(items) < 100:
            break
    return None


def delete_draft(s: requests.Session, app_id: str):
    rel = find_draft(s, app_id)
    if rel:
        s.delete(f"{API}/repos/{repo()}/releases/{rel['id']}", timeout=60)


def init_firestore():
    import firebase_admin
    from firebase_admin import credentials, firestore

    info = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"])
    if not firebase_admin._apps:
        firebase_admin.initialize_app(credentials.Certificate(info))
    return firestore.client()


def set_output(key: str, value: str):
    path = os.environ.get("GITHUB_OUTPUT")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(f"{key}={value}\n")


def read_json(path: str):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def write_json(path: str, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
