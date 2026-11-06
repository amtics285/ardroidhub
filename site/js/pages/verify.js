import { auth } from "../fb.js";
import { html, render, $, toast } from "../ui.js";
import { sendCode, verifyCode, lastSentAt } from "../mail.js";
import { takeNext } from "../state.js";

export function renderVerify(el, _p, user) {
  if (!user) {
    location.hash = "#/login";
    return;
  }
  if (user.emailVerified) {
    location.hash = takeNext("#/account");
    return;
  }

  render(el, html`
    <div class="auth card pad">
      <h1>Verify your email</h1>
      <p>We send a 6-digit code to <b>${user.email}</b>.</p>
      <form id="f" novalidate>
        <label>Verification code
          <input name="code" inputmode="numeric" pattern="[0-9]*" maxlength="6" autocomplete="one-time-code" placeholder="123456" required>
        </label>
        <p class="error" id="err" hidden></p>
        <p class="muted small" id="info"></p>
        <button class="btn block" type="submit">Verify</button>
      </form>
      <p class="small"><button class="btn small ghost" id="resend" type="button">Send me a code</button>
        <span class="muted" id="count"></span></p>
      <p class="small muted">Check your spam folder too. The email can take about a minute to arrive.</p>
    </div>`);

  const err = $("#err");
  const info = $("#info");
  const resend = $("#resend");
  const count = $("#count");
  let timer = null;
  let polling = null;
  let alive = true;

  const showErr = (m) => {
    err.textContent = m;
    err.hidden = !m;
  };

  function tick() {
    const left = Math.ceil((lastSentAt() + 60000 - Date.now()) / 1000);
    if (left > 0) {
      resend.disabled = true;
      count.textContent = `You can ask again in ${left}s`;
    } else {
      resend.disabled = false;
      resend.textContent = lastSentAt() ? "Send a new code" : "Send me a code";
      count.textContent = "";
    }
  }
  timer = setInterval(tick, 1000);
  tick();

  resend.onclick = async () => {
    showErr("");
    resend.disabled = true;
    try {
      await sendCode();
      info.textContent = "Code sent. Please check your email.";
    } catch (ex) {
      showErr(ex.message);
    }
    tick();
  };

  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    showErr("");
    const code = e.target.code.value.trim();
    if (!/^\d{6}$/.test(code)) return showErr("Enter the 6-digit code.");
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Checking…";
    try {
      await verifyCode(code);
    } catch (ex) {
      showErr(ex.message);
      btn.disabled = false;
      btn.textContent = "Verify";
      return;
    }
    // The server now marks the account as verified. That takes up to a minute, so wait for it.
    info.textContent = "Code accepted. Finishing up… (this can take up to a minute)";
    btn.textContent = "Please wait…";
    const started = Date.now();
    polling = setInterval(async () => {
      try {
        await auth.currentUser.reload();
        await auth.currentUser.getIdToken(true);
      } catch { /* try again on the next tick */ }
      if (auth.currentUser && auth.currentUser.emailVerified) {
        clearInterval(polling);
        toast("Email verified. Welcome to AR DroidHub!", "ok");
        if (alive) location.hash = takeNext("#/account");
      } else if (Date.now() - started > 150000) {
        clearInterval(polling);
        if (alive) {
          info.textContent = "";
          showErr("This is taking longer than usual. Refresh the page in a minute.");
          btn.disabled = false;
          btn.textContent = "Verify";
        }
      }
    }, 4000);
  };

  return () => {
    alive = false;
    clearInterval(timer);
    clearInterval(polling);
  };
}
