import {
  auth, db, createUserWithEmailAndPassword, signInWithEmailAndPassword, updateProfile,
  sendPasswordResetEmail, doc, setDoc, serverTimestamp,
} from "../fb.js";
import { html, render, $, toast } from "../ui.js";
import { sendCode } from "../mail.js";

const AUTH_ERRORS = {
  "auth/email-already-in-use": "This email is already registered. Try logging in.",
  "auth/invalid-email": "That email address does not look right.",
  "auth/weak-password": "Choose a stronger password (at least 8 characters).",
  "auth/invalid-credential": "Wrong email or password.",
  "auth/user-not-found": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/too-many-requests": "Too many tries. Please wait a few minutes and try again.",
  "auth/network-request-failed": "Network problem. Check your internet and try again.",
};
const friendly = (e) => AUTH_ERRORS[e.code] || e.message || "Something went wrong.";

function busy(btn, on, text) {
  btn.disabled = on;
  if (text) btn.textContent = text;
}

export function renderLogin(el, _p, user) {
  if (user) {
    location.hash = "#/";
    return;
  }
  render(el, html`
    <div class="auth card pad">
      <h1>Log in</h1>
      <form id="f" novalidate>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <p class="error" id="err" hidden></p>
        <button class="btn block" type="submit">Log in</button>
      </form>
      <p class="small"><a href="#/reset">Forgot password?</a></p>
      <p class="small">New here? <a href="#/register">Create an account</a></p>
    </div>`);

  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    const err = $("#err");
    err.hidden = true;
    busy(btn, true, "Logging in…");
    try {
      await signInWithEmailAndPassword(auth, e.target.email.value.trim(), e.target.password.value);
      location.hash = "#/";
    } catch (ex) {
      err.textContent = friendly(ex);
      err.hidden = false;
      busy(btn, false, "Log in");
    }
  };
}

export function renderReset(el) {
  render(el, html`
    <div class="auth card pad">
      <h1>Reset password</h1>
      <form id="f" novalidate>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <p class="error" id="err" hidden></p>
        <button class="btn block" type="submit">Send reset link</button>
      </form>
      <p class="small"><a href="#/login">Back to log in</a></p>
    </div>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    busy(btn, true);
    try {
      await sendPasswordResetEmail(auth, e.target.email.value.trim());
    } catch (ex) {
      if (ex.code === "auth/network-request-failed") {
        $("#err").textContent = friendly(ex);
        $("#err").hidden = false;
        busy(btn, false);
        return;
      }
    }
    // Same message whether or not the email exists.
    toast("If that email is registered, a reset link is on its way.");
    busy(btn, false);
  };
}

export function renderRegister(el, _p, user) {
  if (user) {
    location.hash = "#/account";
    return;
  }
  render(el, html`
    <div class="auth card pad">
      <h1>Create account</h1>
      <p class="muted">One free account for everything on AR DroidHub.</p>
      <form id="f" novalidate>
        <label>Your name
          <input name="name" type="text" minlength="2" maxlength="60" autocomplete="name" required></label>
        <label>Email<input name="email" type="email" autocomplete="email" required></label>
        <label>Password <small>(min 8 characters)</small>
          <input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
        <label>Confirm password
          <input name="password2" type="password" minlength="8" autocomplete="new-password" required></label>
        <label class="check"><input name="terms" type="checkbox" required>
          <span>I agree to the <a href="#/privacy" target="_blank">Privacy policy</a>.</span></label>
        <p class="error" id="err" hidden></p>
        <button class="btn block" type="submit">Create account</button>
      </form>
      <p class="small">Already registered? <a href="#/login">Log in</a></p>
      <p class="small muted">Want to publish apps? Create your account first, then choose <b>Become a developer</b> in the menu.</p>
    </div>`);

  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $("#err");
    const btn = f.querySelector("button");
    const fail = (m) => {
      err.textContent = m;
      err.hidden = false;
    };
    err.hidden = true;

    const name = f.name.value.trim();
    if (name.length < 2) return fail("Please enter your name.");
    if (f.password.value.length < 8) return fail("Password must be at least 8 characters.");
    if (f.password.value !== f.password2.value) return fail("The two passwords do not match.");
    if (!f.terms.checked) return fail("Please accept the Privacy policy.");

    busy(btn, true, "Creating account…");
    try {
      const cred = await createUserWithEmailAndPassword(auth, f.email.value.trim(), f.password.value);
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "developersPrivate", cred.user.uid), {
        phone: "", email: cred.user.email, createdAt: serverTimestamp(),
      });
      // We email a 6-digit code. If that fails the verify page has a "Send me a code" button.
      try {
        await sendCode();
        toast("Account created. We sent a code to your email.", "ok");
      } catch (ex) {
        console.error(ex);
        toast("Account created. Press 'Send me a code' to get your email code.");
      }
      location.hash = "#/verify";
    } catch (ex) {
      fail(friendly(ex));
      busy(btn, false, "Create account");
    }
  };
}
