"""Step 1: decide whether this run has anything to do, and mark the app as 'checking'.

Only trusted data (Firestore) is touched here. No uploaded file is opened in this step.
Everything is automatic: there is no manual approval.
"""
from firebase_admin import firestore

from common import get_app_id, init_firestore, set_output
from notify import notify


def main():
    app_id = get_app_id()
    db = init_firestore()
    ref = db.collection("apps").document(app_id)
    snap = ref.get()
    if not snap.exists:
        print("App not found, nothing to do.")
        set_output("proceed", "false")
        return

    data = snap.to_dict()
    print(f"App {app_id}: status={data.get('status')}")
    # "checking" is allowed too: a previous run may have been cancelled or timed out half way.
    # Runs for one app never overlap (workflow concurrency group), so this is safe.
    if data.get("status") not in ("pending", "checking"):
        print("Not pending, skipping.")
        set_output("proceed", "false")
        return

    retry = bool(data.get("botError")) or data.get("status") == "checking"  # a retry after an error: do not mail again
    ref.update({"status": "checking", "stage": "scan", "updatedAt": firestore.SERVER_TIMESTAMP})
    if not retry:
        notify(db, app_id, "received")
    set_output("proceed", "true")


if __name__ == "__main__":
    main()
