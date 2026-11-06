import {
  auth, db, doc, getDoc, setDoc, updateDoc, serverTimestamp, updateProfile, sendPasswordResetEmail,
} from "../fb.js";
import { html, render, $, toast, badge } from "../ui.js";
import { me, setDev, initial, setNext } from "../state.js";

function needLogin(user, msg) {
  if (user) return false;
  toast(msg || "Please log in first.");
  location.hash = "#/login";
  return true;
}

export function renderAccount(el, _p, user) {
  if (needLogin(user)) return;
  const dev = me.dev;
  render(el, html`
    <div class="account">
      <section class="card pad account-head">
        <div class="avatar big" aria-hidden="true">${initial(user)}</div>
        <div class="grow">
          <h1>${user.displayName || "Your account"}</h1>
          <div class="muted">${user.email}</div>
          <div class="small">${user.emailVerified
            ? html`<span class="badge green">Email verified</span>`
            : html`<span class="badge amber">Email not verified</span> <a href="#/verify">Verify now</a>`}</div>
        </div>
        <a class="btn ghost" href="#/profile">Edit profile</a>
      </section>

      <section class="card pad">
        <h2>My apps</h2>
        <p class="muted small">Apps you downloaded or saved for later.</p>
        <p class="actions"><a class="btn ghost" href="#/downloads">Downloaded</a>
        <a class="btn ghost" href="#/downloads?tab=saved">Saved</a></p>
      </section>

      <section class="card pad">
        <h2>Developer</h2>
        ${dev
          ? html`<p><b>${dev.name}</b> <span class="muted">(${dev.devType === "company" ? "Company" : "Individual"})</span></p>
                 <p class="actions"><a class="btn" href="#/upload">Publish an app</a>
                 <a class="btn ghost" href="#/dashboard">Developer dashboard</a></p>`
          : html`<p class="muted">Want to publish your own Android apps on AR DroidHub? It is free.</p>
                 <p><a class="btn" href="#/become-developer">Become a developer</a></p>`}
      </section>

      <section class="card pad">
        <h2>Password</h2>
        <p class="muted small">We will email you a link to choose a new password.</p>
        <p><button class="btn ghost" id="pw" type="button">Send password reset email</button></p>
      </section>
    </div>`);

  $("#pw").onclick = async (e) => {
    e.target.disabled = true;
    try {
      await sendPasswordResetEmail(auth, user.email);
      toast("Password reset email sent. Check your inbox.", "ok");
    } catch {
      toast("Could not send the email. Try again later.", "err");
    }
    e.target.disabled = false;
  };
}

export async function renderProfile(el, _p, user) {
  if (needLogin(user)) return;
  const dev = me.dev;
  let phone = "";
  try {
    const p = await getDoc(doc(db, "developersPrivate", user.uid));
    phone = (p.exists() && p.data().phone) || "";
  } catch { /* shown empty */ }

  render(el, html`
    <div class="auth card pad wide">
      <h1>Edit profile</h1>
      <form id="f" novalidate>
        <label>Your name
          <input name="displayName" type="text" maxlength="60" value="${user.displayName || ""}" autocomplete="name" required></label>
        <label>Email <small>(can not be changed here)</small>
          <input type="email" value="${user.email}" disabled></label>
        <label>Phone number <small>(optional, kept private)</small>
          <input name="phone" type="tel" maxlength="20" value="${phone}" autocomplete="tel"></label>
        ${dev ? html`
          <h2 class="section-title">Developer profile</h2>
          <label>Developer name <small>(shown on your apps; changes apply to apps you publish from now on)</small>
            <input name="devName" type="text" minlength="2" maxlength="60" value="${dev.name}" required></label>
          <label>Developer type
            <select name="devType">
              <option value="individual" ${dev.devType === "company" ? "" : "selected"}>Individual</option>
              <option value="company" ${dev.devType === "company" ? "selected" : ""}>Company</option>
            </select></label>
          <label>Website <small>(optional)</small>
            <input name="website" type="url" maxlength="200" value="${dev.website || ""}" placeholder="https://"></label>` : ""}
        <p class="error" id="err" hidden></p>
        <button class="btn block" type="submit">Save changes</button>
      </form>
      <p class="small"><a href="#/account">Back to account</a></p>
    </div>`);

  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $("#err");
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    err.hidden = true;
    const name = f.displayName.value.trim();
    if (name.length < 2) return fail("Please enter your name (at least 2 characters).");
    let website = "";
    if (dev) {
      website = f.website.value.trim();
      if (f.devName.value.trim().length < 2) return fail("Please enter your developer name.");
      if (website && !/^https?:\/\//i.test(website)) return fail("Website must start with http:// or https://");
    }
    const btn = f.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await updateProfile(user, { displayName: name });
      await updateDoc(doc(db, "developersPrivate", user.uid), { phone: f.phone.value.trim() });
      if (dev) {
        const next = { name: f.devName.value.trim(), devType: f.devType.value, website, createdAt: dev.createdAt };
        await updateDoc(doc(db, "developers", user.uid), next);
        setDev(next);
      }
      toast("Profile saved.", "ok");
      location.hash = "#/account";
    } catch (ex) {
      console.error(ex);
      fail("Could not save your profile. Please try again.");
      btn.disabled = false;
      btn.textContent = "Save changes";
    }
  };
}

export function renderBecomeDeveloper(el, _p, user) {
  if (needLogin(user, "Log in or create an account first, then become a developer.")) return;
  if (me.dev) {
    location.hash = "#/dashboard";
    return;
  }
  if (!user.emailVerified) {
    toast("Please verify your email first.");
    setNext("#/become-developer");
    location.hash = "#/verify";
    return;
  }
  render(el, html`
    <div class="auth card pad wide">
      <h1>Become a developer</h1>
      <p class="muted">Publish your Android apps on AR DroidHub for free. Tell us who you are. This name is shown on your apps.</p>
      <form id="f" novalidate>
        <label>Developer name <small>(shown on your apps)</small>
          <input name="name" type="text" minlength="2" maxlength="60" value="${user.displayName || ""}" required></label>
        <label>Developer type
          <select name="devType"><option value="individual">Individual</option><option value="company">Company</option></select></label>
        <label>Website <small>(optional)</small>
          <input name="website" type="url" maxlength="200" placeholder="https://"></label>
        <label class="check"><input name="terms" type="checkbox" required>
          <span>I agree to the <a href="#/terms" target="_blank">Developer policy</a>: no malware, no pirated or copied apps, and I own the rights to what I upload.</span></label>
        <p class="error" id="err" hidden></p>
        <button class="btn block" type="submit">Become a developer</button>
      </form>
    </div>`);

  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const err = $("#err");
    const fail = (m) => { err.textContent = m; err.hidden = false; };
    err.hidden = true;
    const name = f.name.value.trim();
    const website = f.website.value.trim();
    if (name.length < 2) return fail("Please enter your developer name.");
    if (!f.terms.checked) return fail("Please accept the Developer policy.");
    if (website && !/^https?:\/\//i.test(website)) return fail("Website must start with http:// or https://");
    const btn = f.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Saving…";
    try {
      await setDoc(doc(db, "developers", user.uid), { name, devType: f.devType.value, website, createdAt: serverTimestamp() });
      setDev({ name, devType: f.devType.value, website });
      toast("You are a developer now. You can publish your first app.", "ok");
      location.hash = "#/upload";
    } catch (ex) {
      console.error(ex);
      fail("Could not save. Please try again.");
      btn.disabled = false;
      btn.textContent = "Become a developer";
    }
  };
}
