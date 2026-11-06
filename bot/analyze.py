"""Step 3: inspect the downloaded files. Runs WITHOUT any secrets in its environment.

Nothing from the APK is ever executed: it is only unzipped-in-memory, parsed and scanned.
Output: work/analysis.json
"""
import glob
import hashlib
import json
import os
import re
import subprocess
import zipfile

from PIL import Image

import policy

WORK = "work"
Image.MAX_IMAGE_PIXELS = 40_000_000

errors, flags, report = [], [], []
meta = {}


def add(status, check, detail):
    report.append({"check": check, "status": status, "detail": detail})
    if status == "fail":
        errors.append(f"{check}: {detail}")
    elif status == "warn":
        flags.append(f"{check}: {detail}")


def first(pattern):
    hits = sorted(glob.glob(os.path.join(WORK, pattern)))
    return hits[0] if hits else None


# ---------- images ----------

def check_icon():
    path = first("icon.*")
    if not path:
        add("fail", "App icon", "missing")
        return
    try:
        size_bytes = os.path.getsize(path)
        with Image.open(path) as im:
            fmt, (w, h) = im.format, im.size
            im.load()
        if fmt not in ("PNG", "JPEG"):
            add("fail", "App icon", f"must be PNG or JPG (got {fmt})")
        elif (w, h) != (512, 512):
            add("fail", "App icon", f"must be exactly 512x512 px (yours is {w}x{h})")
        elif size_bytes > 1024 * 1024:
            add("fail", "App icon", "must be 1 MB or smaller")
        else:
            add("pass", "App icon", "512x512, OK")
            meta["icon"] = os.path.basename(path)
    except Exception as e:  # corrupt / decompression bomb / not an image
        add("fail", "App icon", f"not a valid image ({type(e).__name__})")


def check_screenshots():
    paths = sorted(glob.glob(os.path.join(WORK, "ss[1-8].*")))
    if len(paths) < 2:
        add("fail", "Screenshots", f"at least 2 required (found {len(paths)})")
        return
    ok_files = []
    problems = []
    for p in paths:
        name = os.path.basename(p)
        try:
            size_bytes = os.path.getsize(p)
            with Image.open(p) as im:
                fmt, (w, h) = im.format, im.size
                im.load()
            if fmt not in ("PNG", "JPEG"):
                problems.append(f"{name}: must be PNG or JPG")
            elif min(w, h) < 320 or max(w, h) > 3840:
                problems.append(f"{name}: each side must be between 320 and 3840 px (yours is {w}x{h})")
            elif max(w, h) > 2 * min(w, h):
                problems.append(f"{name}: longer side can not be more than 2x the shorter side ({w}x{h})")
            elif size_bytes > 8 * 1024 * 1024:
                problems.append(f"{name}: must be 8 MB or smaller")
            else:
                ok_files.append(name)
        except Exception as e:
            problems.append(f"{name}: not a valid image ({type(e).__name__})")
    if problems:
        add("fail", "Screenshots", "; ".join(problems))
    else:
        add("pass", "Screenshots", f"{len(ok_files)} screenshots, OK")
        meta["screens"] = ok_files


# ---------- apk ----------

PKG_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$")


def check_apk():
    path = os.path.join(WORK, "app.apk")
    if not os.path.exists(path):
        add("fail", "APK file", "missing")
        return
    size = os.path.getsize(path)
    if size > policy.MAX_APK_MB * 1024 * 1024:
        add("fail", "APK size", f"larger than {policy.MAX_APK_MB} MB")
        return

    with open(path, "rb") as f:
        if f.read(4) != b"PK\x03\x04":
            add("fail", "APK file", "not a valid APK (not a zip archive)")
            return

    try:
        with zipfile.ZipFile(path) as z:
            infos = z.infolist()
            names = {i.filename for i in infos}
            if len(infos) > 40000:
                add("fail", "APK file", "too many files inside")
                return
            if sum(i.file_size for i in infos) > 2 * 1024 * 1024 * 1024:
                add("fail", "APK file", "unpacked size is too large")
                return
            if "AndroidManifest.xml" not in names:
                add("fail", "APK file", "AndroidManifest.xml is missing")
                return
            if not any(n.startswith("classes") and n.endswith(".dex") for n in names):
                add("warn", "APK code", "no classes.dex found (native-only app?)")
            bad = z.testzip()
            if bad:
                add("fail", "APK file", f"corrupt entry: {bad}")
                return
    except zipfile.BadZipFile:
        add("fail", "APK file", "corrupt zip archive")
        return

    sha = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            sha.update(chunk)
    meta["sha256"] = sha.hexdigest()
    meta["size"] = size

    try:
        from pyaxmlparser import APK

        apk = APK(path)
        package = apk.package or ""
        if not PKG_RE.match(package):
            add("fail", "Package name", f"invalid package name '{package}'")
            return
        meta["package"] = package
        meta["versionName"] = str(apk.version_name or "")
        meta["versionCode"] = int(apk.version_code or 0)
        meta["minSdk"] = str(apk.get_min_sdk_version() or "")
        meta["targetSdk"] = str(apk.get_target_sdk_version() or "")
        meta["label"] = str(apk.get_app_name() or "")
        meta["permissions"] = sorted(set(apk.get_permissions()))
        add("pass", "APK structure", f"{package} v{meta['versionName']} ({meta['versionCode']})")
    except Exception as e:
        add("fail", "APK structure", f"could not read the manifest ({type(e).__name__})")
        return

    risky = [p for p in meta["permissions"] if p in policy.RISKY_PERMISSIONS]
    if risky:
        add("warn", "Permissions", "sensitive: " + ", ".join(p.split(".")[-1] for p in risky))
    else:
        add("pass", "Permissions", f"{len(meta['permissions'])} permissions, none sensitive")

    check_signature(path)
    check_clamav(path)


def check_signature(path):
    try:
        r = subprocess.run(
            ["apksigner", "verify", "--print-certs", path],
            capture_output=True, text=True, timeout=180,
        )
    except FileNotFoundError:
        add("warn", "Signature", "apksigner not available, could not verify")
        return
    except subprocess.TimeoutExpired:
        add("warn", "Signature", "verification timed out")
        return
    out = (r.stdout or "") + (r.stderr or "")
    if r.returncode != 0:
        add("fail", "Signature", "APK is unsigned or the signature is invalid")
    elif "Android Debug" in out:
        add("warn", "Signature", "signed with a debug key")
    else:
        add("pass", "Signature", "valid signature")


def check_clamav(path):
    try:
        r = subprocess.run(
            ["clamscan", "--no-summary", path], capture_output=True, text=True, timeout=900
        )
    except FileNotFoundError:
        add("warn", "ClamAV scan", "ClamAV not available")
        return
    except subprocess.TimeoutExpired:
        add("warn", "ClamAV scan", "scan timed out")
        return
    if r.returncode == 0:
        add("pass", "ClamAV scan", "no threats found")
    elif r.returncode == 1:
        found = [line.split(":", 1)[-1].strip() for line in r.stdout.splitlines() if line.endswith("FOUND")]
        add("fail", "ClamAV scan", "threat detected: " + (", ".join(found) or "unknown"))
    else:
        add("warn", "ClamAV scan", "scanner error, manual review needed")


def main():
    check_icon()
    check_screenshots()
    check_apk()
    out = {"errors": errors, "flags": flags, "report": report, "meta": meta}
    with open(os.path.join(WORK, "analysis.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
