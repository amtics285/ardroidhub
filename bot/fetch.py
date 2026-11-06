"""Step 2: download the files from the draft release into ./work (no Firebase secrets here)."""
import os

from common import ASSET_RE, WORK, find_draft, get_app_id, gh_session, write_json

MAX_BYTES = 100 * 1024 * 1024


def main():
    app_id = get_app_id()
    os.makedirs(WORK, exist_ok=True)
    s = gh_session()
    rel = find_draft(s, app_id)
    if not rel:
        write_json(f"{WORK}/fetch.json", {"release_id": None, "assets": []})
        print("No draft release found.")
        return

    saved = []
    for a in rel.get("assets", []):
        name = a.get("name", "")
        if a.get("state") != "uploaded" or not ASSET_RE.match(name):
            print("Ignoring asset:", name)
            continue
        if a.get("size", 0) > MAX_BYTES:
            print("Asset too large, ignoring:", name)
            continue
        # The API URL redirects to storage; requests drops the Authorization header on that hop.
        r = s.get(a["url"], headers={"Accept": "application/octet-stream"}, stream=True, timeout=300)
        r.raise_for_status()
        total = 0
        with open(os.path.join(WORK, name), "wb") as f:
            for chunk in r.iter_content(1024 * 1024):
                total += len(chunk)
                if total > MAX_BYTES:
                    raise RuntimeError(f"{name} exceeded the size limit while downloading")
                f.write(chunk)
        saved.append(name)
        print(f"Downloaded {name} ({total} bytes)")

    write_json(f"{WORK}/fetch.json", {"release_id": rel["id"], "assets": saved})


if __name__ == "__main__":
    main()
