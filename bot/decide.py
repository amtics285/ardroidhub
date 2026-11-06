"""Step 4: combine the analysis with VirusTotal + store rules, then publish / hold / reject.

This step holds the secrets (Firebase, VirusTotal, GitHub) but never parses the uploaded
files itself: it only reads work/analysis.json and streams the APK to VirusTotal as raw bytes.
"""
import os
import re
import time
import traceback

import requests
from firebase_admin import firestore

import policy
from common import API, WORK, delete_draft, get_app_id, gh_session, init_firestore, read_json, repo

VT = "https://www.virustotal.com/api/v3"


# ---------- helpers ----------

def add(report, errors, flags, status, check, detail):
    report.append({"check": check, "status": status, "detail": detail})
    if status == "fail":
        errors.append(f"{check}: {detail}")
    elif status == "warn":
        flags.append(f"{check}: {detail}")


def words_in(text, words):
    found = []
    for w in words:
        if re.search(r"(?<![a-z0-9])" + re.escape(w) + r"(?![a-z0-9])", text):
            found.append(w)
    return found


def text_checks(doc, meta, report, errors, flags):
    name = (doc.get("name") or "").lower()
    blob = " ".join(
        str(doc.get(k) or "") for k in ("name", "shortDesc", "fullDesc", "whatsNew")
    ).lower()

    blocked = words_in(blob, policy.BLOCKED_WORDS)
    if blocked:
        add(report, errors, flags, "fail", "Content policy", "not allowed: " + ", ".join(blocked))
    else:
        add(report, errors, flags, "pass", "Content policy", "name and descriptions look fine")

    review = words_in(blob, policy.REVIEW_WORDS)
    if review:
        add(report, errors, flags, "warn", "Piracy / cheating words", ", ".join(review))

    brands = [b for b in policy.BRAND_NAMES if b in name.replace(" ", "")]
    if brands:
        add(report, errors, flags, "warn", "Brand name in app name", ", ".join(brands))

    pkg = meta.get("package", "")
    if pkg.startswith(policy.PROTECTED_PACKAGE_PREFIXES):
        add(report, errors, flags, "warn", "Package name", f"{pkg} looks like a well-known company's package")


def duplicate_check(db, app_id, pkg, report, errors, flags):
    live = ("approved", "review", "checking", "pending")
    for d in db.collection("apps").where("package", "==", pkg).stream():
        if d.id != app_id and (d.to_dict() or {}).get("status") in live:
            add(report, errors, flags, "fail", "Duplicate app", f"another app already uses the package name {pkg}")
            return
    add(report, errors, flags, "pass", "Duplicate app", "package name is unique")


# ---------- VirusTotal ----------

def vt_stats_from_file(sha, key):
    r = requests.get(f"{VT}/files/{sha}", headers={"x-apikey": key}, timeout=60)
    if r.status_code == 404:
        return None
    r.raise_for_status()
    stats = r.json()["data"]["attributes"].get("last_analysis_stats") or {}
    return stats if sum(stats.values()) > 0 else None


def vt_upload(path, key):
    url = f"{VT}/files"
    if os.path.getsize(path) > 32 * 1024 * 1024:
        r = requests.get(f"{VT}/files/upload_url", headers={"x-apikey": key}, timeout=60)
        r.raise_for_status()
        url = r.json()["data"]
    with open(path, "rb") as f:
        r = requests.post(url, headers={"x-apikey": key}, files={"file": ("app.apk", f)}, timeout=900)
    r.raise_for_status()
    return r.json()["data"]["id"]


def vt_wait(analysis_id, key, max_seconds=900):
    deadline = time.time() + max_seconds
    while time.time() < deadline:
        time.sleep(20)  # free API allows 4 requests per minute
        r = requests.get(f"{VT}/analyses/{analysis_id}", headers={"x-apikey": key}, timeout=60)
        r.raise_for_status()
        attrs = r.json()["data"]["attributes"]
        if attrs.get("status") == "completed":
            return attrs.get("stats") or {}
    raise TimeoutError("VirusTotal analysis did not finish in time")


def virustotal(path, sha, report, errors, flags):
    key = os.environ.get("VT_API_KEY", "")
    if not key:
        add(report, errors, flags, "warn", "VirusTotal", "no API key configured")
        return None
    try:
        stats = vt_stats_from_file(sha, key)
        if stats is None:
            stats = vt_wait(vt_upload(path, key), key)
    except Exception as e:
        add(report, errors, flags, "warn", "VirusTotal", f"scan unavailable ({type(e).__name__}), manual review needed")
        return None

    mal = int(stats.get("malicious", 0))
    sus = int(stats.get("suspicious", 0))
    summary = f"{mal} malicious, {sus} suspicious"
    if mal >= policy.VT_REJECT_MALICIOUS:
        add(report, errors, flags, "fail", "VirusTotal", f"flagged by {mal} engines")
    elif mal >= policy.VT_REVIEW_MALICIOUS or sus >= policy.VT_REVIEW_SUSPICIOUS:
        add(report, errors, flags, "warn", "VirusTotal", summary)
    else:
        add(report, errors, flags, "pass", "VirusTotal", "clean (" + summary + ")")
    return {"malicious": mal, "suspicious": sus}


# ---------- publishing ----------

def publish(s, app_id, meta):
    """Copy the checked files from ./work into a new PUBLIC release and return their URLs."""
    r_name = repo()
    version_code = meta.get("versionCode", 0)
    tag = f"app-{app_id}-v{version_code}"
    apk_name = re.sub(r"[^A-Za-z0-9._-]", "_", f"{meta['package']}-{meta.get('versionName') or version_code}.apk")

    r = s.post(
        f"{API}/repos/{r_name}/releases",
        json={
            "tag_name": tag,
            "name": f"{meta.get('label') or meta['package']} {meta.get('versionName', '')}".strip(),
            "body": f"Package: `{meta['package']}`\n\nSHA-256: `{meta['sha256']}`",
            "draft": False,
            "prerelease": False,
            "make_latest": "false",
            "target_commitish": "main",
        },
        timeout=60,
    )
    if r.status_code == 422:  # tag exists from an earlier, interrupted run: reuse it
        r = s.get(f"{API}/repos/{r_name}/releases/tags/{tag}", timeout=60)
    r.raise_for_status()
    rel = r.json()
    for a in rel.get("assets", []):
        s.delete(f"{API}/repos/{r_name}/releases/assets/{a['id']}", timeout=60)

    upload_url = f"https://uploads.github.com/repos/{r_name}/releases/{rel['id']}/assets"

    def upload(local, remote, ctype):
        with open(os.path.join(WORK, local), "rb") as f:
            resp = s.post(
                upload_url, params={"name": remote}, data=f,
                headers={"Content-Type": ctype}, timeout=(30, 1800),
            )
        resp.raise_for_status()

    base = f"https://github.com/{r_name}/releases/download/{tag}/"
    upload("app.apk", apk_name, "application/vnd.android.package-archive")
    icon = meta["icon"]
    upload(icon, icon, "image/png" if icon.endswith("png") else "image/jpeg")
    for name in meta["screens"]:
        upload(name, name, "image/png" if name.endswith("png") else "image/jpeg")

    return {
        "tag": tag,
        "apkUrl": base + apk_name,
        "iconUrl": base + icon,
        "screenshots": [base + n for n in meta["screens"]],
    }


# ---------- main ----------

def main():
    app_id = get_app_id()
    force = os.environ.get("ACTION") == "approve"
    db = init_firestore()
    ref = db.collection("apps").document(app_id)
    doc = ref.get().to_dict() or {}
    s = gh_session()

    try:
        analysis = read_json(f"{WORK}/analysis.json")
    except FileNotFoundError:
        ref.update({"status": "pending", "botError": "analysis did not run", "updatedAt": firestore.SERVER_TIMESTAMP})
        raise

    report = list(analysis["report"])
    errors = list(analysis["errors"])
    flags = list(analysis["flags"])
    meta = analysis["meta"]
    vt_stats = None

    try:
        if "package" in meta:
            text_checks(doc, meta, report, errors, flags)
            duplicate_check(db, app_id, meta["package"], report, errors, flags)
        if not errors and meta.get("sha256"):
            vt_stats = virustotal(os.path.join(WORK, "app.apk"), meta["sha256"], report, errors, flags)

        now = firestore.SERVER_TIMESTAMP

        if errors:
            reason = "; ".join(errors)[:500]
            print("REJECT:", reason)
            delete_draft(s, app_id)
            ref.update({"status": "rejected", "reason": reason, "report": report, "updatedAt": now})
            return

        if flags and not force:
            print("MANUAL REVIEW:", flags)
            ref.update(
                {
                    "status": "review",
                    "reason": firestore.DELETE_FIELD,
                    "reviewNotes": flags,
                    "report": report,
                    "package": meta.get("package"),
                    "versionName": meta.get("versionName"),
                    "updatedAt": now,
                }
            )
            return

        urls = publish(s, app_id, meta)
        delete_draft(s, app_id)
        update = {
            "status": "approved",
            "reason": firestore.DELETE_FIELD,
            "reviewNotes": firestore.DELETE_FIELD,
            "botError": firestore.DELETE_FIELD,
            "report": report,
            "package": meta["package"],
            "versionName": meta.get("versionName", ""),
            "versionCode": meta.get("versionCode", 0),
            "minSdk": meta.get("minSdk", ""),
            "targetSdk": meta.get("targetSdk", ""),
            "permissions": meta.get("permissions", []),
            "size": meta["size"],
            "sha256": meta["sha256"],
            "apkUrl": urls["apkUrl"],
            "iconUrl": urls["iconUrl"],
            "screenshots": urls["screenshots"],
            "releaseTag": urls["tag"],
            "publishedAt": now,
            "updatedAt": now,
        }
        if vt_stats is not None:
            update["vt"] = vt_stats
        ref.update(update)
        print("APPROVED:", urls["apkUrl"])

    except Exception as e:
        traceback.print_exc()
        # Put the app back in the queue so the run can simply be retried.
        ref.update(
            {
                "status": "pending",
                "botError": f"{type(e).__name__}: {str(e)[:200]}",
                "updatedAt": firestore.SERVER_TIMESTAMP,
            }
        )
        raise


if __name__ == "__main__":
    main()
