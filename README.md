# AR DroidHub

A small community Android app store.

| Part | Where | Tech |
|---|---|---|
| Website | `site/` (GitHub Pages) | plain HTML/CSS/JS, Firebase Auth + Firestore |
| Upload proxy | `worker/` (Cloudflare Worker) | verifies the Firebase login, stores files in a *draft* GitHub release, starts the bot |
| Review bot | `bot/` (GitHub Actions) | Python: APK/icon/screenshot checks, ClamAV, VirusTotal, publish |
| Rules | `firestore.rules` | paste into Firebase console -> Firestore -> Rules |

## Flow

1. Developer signs up (Firebase Auth, email verification) and fills the 4-step upload wizard.
2. Files go site -> Worker -> draft GitHub release (private until reviewed).
3. Worker marks the app `pending` and starts `review.yml`.
4. The bot checks everything and sets the app to `approved`, `rejected` (with reasons) or `review` (manual).
5. Approved files are copied to a public release; the site reads app data from Firestore.

## Manual review

Apps in `review` stay in a draft release. Open **Actions -> Review app -> Run workflow** and pass the
`app_id` (the Firestore document id) with `approve` or `reject` (+ a reason).

## Secrets (repo -> Settings -> Secrets and variables -> Actions)

`FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID`, `VT_API_KEY`, `GH_PAT`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

## Security notes

* The uploaded APK is never executed. The bot only parses and scans it.
* The step that parses uploaded files runs without any secrets in its environment.
* The Worker acts as the logged-in user when talking to Firestore, so the security rules apply to it.
* Edit `bot/policy.py` to change blocked words, risky permissions and VirusTotal thresholds.
