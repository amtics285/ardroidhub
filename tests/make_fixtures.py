"""Builds a tiny fake APK (real binary AndroidManifest, dummy code) plus test images.

Used to test the bot's checks without needing a real app:
    python tests/make_fixtures.py bot/work
"""
import os
import struct
import sys
import zipfile

from PIL import Image

ANDROID_NS = "http://schemas.android.com/apk/res/android"


def _utf16(s):
    return struct.pack("<H", len(s)) + s.encode("utf-16-le") + b"\x00\x00"


def build_manifest(package="com.example.test", code=7, name="1.2.3", perms=("android.permission.INTERNET",)):
    strings = []

    def sid(s):
        if s not in strings:
            strings.append(s)
        return strings.index(s)

    NONE = 0xFFFFFFFF
    body = b""

    def chunk(ctype, header_size, payload):
        return struct.pack("<HHI", ctype, header_size, 8 + len(payload)) + payload

    def start_ns():
        return chunk(0x0100, 16, struct.pack("<IIII", 1, NONE, sid("android"), sid(ANDROID_NS)))

    def end_ns():
        return chunk(0x0101, 16, struct.pack("<IIII", 1, NONE, sid("android"), sid(ANDROID_NS)))

    def attr(ns, name, value, kind):
        if kind == "str":
            return struct.pack("<IIIHBBI", ns, sid(name), sid(value), 8, 0, 0x03, sid(value))
        return struct.pack("<IIIHBBI", ns, sid(name), NONE, 8, 0, 0x10, value)

    def start(tag, attrs):
        a = b"".join(attrs)
        payload = struct.pack("<IIIIHHHHHH", 1, NONE, NONE, sid(tag), 0x14, 0x14, len(attrs), 0, 0, 0) + a
        return chunk(0x0102, 16, payload)

    def end(tag):
        return chunk(0x0103, 16, struct.pack("<IIII", 1, NONE, NONE, sid(tag)))

    ns = sid(ANDROID_NS)
    body += start_ns()
    body += start("manifest", [
        attr(NONE, "package", package, "str"),
        attr(ns, "versionCode", code, "int"),
        attr(ns, "versionName", name, "str"),
    ])
    body += start("uses-sdk", [attr(ns, "minSdkVersion", 21, "int"), attr(ns, "targetSdkVersion", 34, "int")])
    body += end("uses-sdk")
    for p in perms:
        body += start("uses-permission", [attr(ns, "name", p, "str")])
        body += end("uses-permission")
    body += start("application", [attr(ns, "label", "Test App", "str")])
    body += end("application")
    body += end("manifest")
    body += end_ns()

    pool_strings = b"".join(_utf16(s) for s in strings)
    offsets, pos = [], 0
    for s in strings:
        offsets.append(pos)
        pos += len(_utf16(s))
    pad = (4 - len(pool_strings) % 4) % 4
    pool_strings += b"\x00" * pad
    strings_start = 28 + 4 * len(strings)
    pool_payload = struct.pack("<IIIII", len(strings), 0, 0, strings_start, 0)
    pool_payload += b"".join(struct.pack("<I", o) for o in offsets) + pool_strings
    pool = struct.pack("<HHI", 0x0001, 28, 8 + len(pool_payload)) + pool_payload

    content = pool + body
    return struct.pack("<HHI", 0x0003, 8, 8 + len(content)) + content


def build_apk(path, **kw):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("AndroidManifest.xml", build_manifest(**kw))
        z.writestr("classes.dex", b"dex\n035\x00" + b"\x00" * 100)
        z.writestr("res/dummy.txt", "hello")


def build_images(out, icon_size=(512, 512), shot_sizes=((1080, 1920), (1080, 2160))):
    Image.new("RGB", icon_size, (1, 135, 95)).save(os.path.join(out, "icon.png"))
    for i, size in enumerate(shot_sizes, 1):
        ext = "png" if i % 2 else "jpg"
        Image.new("RGB", size, (200, 220, 255)).save(os.path.join(out, f"ss{i}.{ext}"))


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "work"
    os.makedirs(out, exist_ok=True)
    build_apk(os.path.join(out, "app.apk"))
    build_images(out)
    print("fixtures written to", out)
