# AR DroidHub

A small community Android app store.

| Part | Where | Tech |
|---|---|---|
| Website | `site/` (GitHub Pages) | plain HTML/CSS/JS, Firebase Auth + Firestore |
| Upload proxy | `worker/` (Cloudflare Worker) | verifies the Firebase login, stores files in a *draft* GitHub release, starts the bot |
| Review bot | `bot/` (GitHub Actions) | Python: APK/icon/screenshot checks, ClamAV, VirusTotal, publish |
| Rules | `firestore.rules` | paste into Firebase console -> Firestore -> Rules |

## Flow

1. Anyone can create an account (Firebase Auth + email code). Choosing **Become a developer** in the menu unlocks the 4-step upload wizard.
2. Files go site -> Worker -> draft GitHub release (private until reviewed).
3. Worker marks the app `pending` and starts `review.yml`.
4. The bot checks everything and sets the app to `approved` or `rejected` (with reasons). There is no manual review. The developer sees live phases (queue, checking, final checks) and gets an email for received / published / rejected.
5. Approved files are copied to a public release; the site reads app data from Firestore.

## Policy

All rules live in `bot/policy.py` (blocked words incl. abusive language, brand names, protected package names, VirusTotal thresholds). Edit and push to change them.

## Secrets (repo -> Settings -> Secrets and variables -> Actions)

`FIREBASE_SERVICE_ACCOUNT`, `FIREBASE_PROJECT_ID`, `VT_API_KEY`, `GH_PAT`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`

For the email verification codes:

| Secret | What |
|---|---|
| `SMTP_USER` | Gmail address the codes are sent from |
| `SMTP_PASS` | Gmail *app password* (Google Account -> Security -> 2-Step Verification -> App passwords) |
| `MAIL_KEY` | random 32-byte key, base64 (`openssl rand -base64 32`). Shared by the Worker and the email bot |
| `CODE_SECRET` | another random string (`openssl rand -base64 32`). Only the Worker uses it |

## Email verification codes

1. After sign up the site asks the Worker for a code. The Worker derives a 6-digit code with HMAC(`CODE_SECRET`, uid + email + 10-minute window), so nothing is stored.
2. The Worker starts `send-code.yml` with the address + code **AES-GCM encrypted** (run inputs of a public repo are visible to everyone). The bot decrypts it and sends the mail through Gmail SMTP.
3. The user types the code. The Worker checks it and starts `verify-email.yml`, which sets `emailVerified` with the Admin SDK. The site polls until it flips.
4. Rate limits live in `firestore.rules` (`developersPrivate/{uid}`): 60 s between codes, 20 codes and 30 guesses per account. The Worker writes these counters as the user, so the rules enforce them.

## Security notes

* The uploaded APK is never executed. The bot only parses and scans it.
* The step that parses uploaded files runs without any secrets in its environment.
* The Worker acts as the logged-in user when talking to Firestore, so the security rules apply to it.
* Edit `bot/policy.py` to change blocked words, risky permissions and VirusTotal thresholds.
