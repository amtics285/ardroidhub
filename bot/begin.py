"""Step 1: decide whether this run has anything to do, and mark the app as 'checking'.

Only trusted data (Firestore) is touched here. No uploaded file is opened in this step.
"""
import os

from firebase_admin import firestore

from common import delete_draft, get_app_id, gh_session, init_firestore, set_output


def main():
    app_id = get_app_id()
    action = os.environ.get("ACTION", "review")
    db = init_firestore()
    ref = db.collection("apps").document(app_id)
    snap = ref.get()
    if not snap.exists:
        print("App not found, nothing to do.")
        set_output("proceed", "false")
        return

    status = snap.to_dict().get("status")
    print(f"App {app_id}: status={status}, action={action}")

    if action == "review":
        if status != "pending":
            print("Not pending, skipping.")
            set_output("proceed", "false")
            return
    elif action == "approve":
        if status != "review":
            print("Only apps in manual review can be approved, skipping.")
            set_output("proceed", "false")
            return
    elif action == "reject":
        if status != "review":
            print("Only apps in manual review can be rejected, skipping.")
            set_output("proceed", "false")
            return
        reason = (os.environ.get("REASON") or "").strip() or "Rejected by the AR DroidHub team."
        delete_draft(gh_session(), app_id)
        ref.update(
            {
                "status": "rejected",
                "reason": reason[:500],
                "updatedAt": firestore.SERVER_TIMESTAMP,
            }
        )
        set_output("proceed", "false")
        return
    else:
        print("Unknown action.")
        set_output("proceed", "false")
        return

    ref.update({"status": "checking", "updatedAt": firestore.SERVER_TIMESTAMP})
    set_output("proceed", "true")


if __name__ == "__main__":
    main()
