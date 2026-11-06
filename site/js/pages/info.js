import { html, render } from "../ui.js";
import { SUPPORT_EMAIL, SUPPORT_ISSUES_URL } from "../config.js";

const page = (el, body) => render(el, html`<article class="prose card pad">${body}</article>`);

export function renderAbout(el) {
  page(el, html`
    <h1>About us</h1>
    <p>AR DroidHub is a free store for Android apps. You can browse, search and download apps straight to your phone, without creating an account.</p>
    <h2>For everyone</h2>
    <ul>
      <li>Download apps for free as APK files.</li>
      <li>See an app's permissions, size, version and developer before you install.</li>
      <li>No account is needed to install anything.</li>
    </ul>
    <h2>For developers</h2>
    <p>Anyone can become a developer from the menu and publish apps for free. Every upload is reviewed automatically before it appears in the store, and you get an email and live progress updates at every step.</p>
    <p><a class="btn" href="#/">Browse apps</a></p>`);
}

export function renderCompany(el) {
  page(el, html`
    <h1>Our company</h1>
    <p>AR DroidHub is an independent project. We run the store, review the apps developers upload and look after the people who use it.</p>
    <h2>What we believe</h2>
    <ul>
      <li>Apps should be easy to find and free to download.</li>
      <li>Developers should be able to publish without fees or paperwork.</li>
      <li>Users should know what an app can access before they install it.</li>
    </ul>
    <h2>Contact</h2>
    <p>For questions, partnerships or press, please use the <a href="#/support">Support</a> page.</p>`);
}

export function renderSupport(el) {
  page(el, html`
    <h1>Support</h1>
    <p>Need help? Start with the answers below.</p>

    <h2>How do I install an app?</h2>
    <p>Open the app page and press <b>Install (download APK)</b>. When the download finishes, open the file. Android may ask you to allow installs from your browser. This is normal for apps outside Google Play.</p>

    <h2>My verification code did not arrive</h2>
    <p>Check your spam folder and wait a minute or two. You can ask for a new code every 60 seconds on the verify page.</p>

    <h2>My app was rejected. What now?</h2>
    <p>Open <b>My apps</b> in the menu. The reason is shown on the app, and you also got it by email. Fix the problem, then press <b>Fix &amp; resubmit</b>.</p>

    <h2>Report an app or ask for removal</h2>
    <p>If you think an app is harmful, copied, or uses your work, tell us the app name and the problem. We will look at it and remove it if needed.</p>

    <h2>Contact us</h2>
    <ul>
      <li>Open a request: <a href="${SUPPORT_ISSUES_URL}" target="_blank" rel="noopener noreferrer">${SUPPORT_ISSUES_URL}</a></li>
      ${SUPPORT_EMAIL ? html`<li>Email: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></li>` : ""}
    </ul>
    <p class="muted small">Please do not post passwords or private information in public requests.</p>`);
}

export function renderPrivacy(el) {
  page(el, html`
    <h1>Privacy policy</h1>
    <p class="muted">Last updated: 6 November 2026</p>
    <p>This page explains what AR DroidHub collects, why, and who helps us run the store.</p>

    <h2>If you only browse and download</h2>
    <p>You do not need an account. We do not ask for your name or email to download an app.</p>

    <h2>If you create an account</h2>
    <ul>
      <li><b>Name and email</b> to identify your account and send you the verification code.</li>
      <li><b>Password</b>. It is handled by Google Firebase Authentication. We never see it or store it ourselves.</li>
      <li><b>Phone number</b> only if you choose to add it. It is private and never shown to others.</li>
    </ul>

    <h2>If you become a developer</h2>
    <ul>
      <li>Your <b>developer name, type and website</b> are public on your apps.</li>
      <li>Your app name, description, screenshots, icon, contact email and the APK are public once the app is published.</li>
      <li>We read your APK to check that it is valid and safe (package name, permissions, signature).
          Your APK is also sent to <b>VirusTotal</b>, a third-party malware scanning service, which may share samples with the security community.</li>
    </ul>

    <h2>Emails we send</h2>
    <p>We send the verification code, and for developers the status of each app (received, published or rejected). We do not send advertising.</p>

    <h2>Who helps us run the store</h2>
    <ul>
      <li><b>Google Firebase</b> for sign-in and the database.</li>
      <li><b>GitHub</b> to host this website and to store app files.</li>
      <li><b>Cloudflare</b> to receive uploads from developers.</li>
      <li><b>VirusTotal</b> for malware scanning of uploaded APKs.</li>
    </ul>

    <h2>Cookies and tracking</h2>
    <p>We do not run ads or analytics trackers. Your browser keeps a sign-in session so you stay logged in.</p>

    <h2>Your choices</h2>
    <p>You can change your name and phone number from <b>Edit profile</b>. To delete your account or an app, or to ask a question about your data, contact us from the <a href="#/support">Support</a> page.</p>`);
}
