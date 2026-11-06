import {
  auth, db, doc, getDoc, addDoc, updateDoc, collection, serverTimestamp, deleteField,
} from "../fb.js";
import { html, render, $, $$, esc, fmtSize, toast, raw } from "../ui.js";
import { CATEGORIES, LIMITS, WORKER_URL } from "../config.js";
import { me } from "../state.js";

const STEPS = ["App details", "Graphics", "APK file", "Review & submit"];

/* ---------- file checks (same rules as the server review, so people find out early) ---------- */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ url, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("not an image"));
    };
    img.src = url;
  });
}

const isImageType = (f) => f.type === "image/png" || f.type === "image/jpeg";

async function checkIcon(file) {
  if (!isImageType(file)) throw new Error("Icon must be a PNG or JPG file.");
  if (file.size > LIMITS.iconBytes) throw new Error("Icon must be 1 MB or smaller.");
  const info = await loadImage(file).catch(() => {
    throw new Error("That file is not a valid image.");
  });
  if (info.w !== 512 || info.h !== 512) {
    URL.revokeObjectURL(info.url);
    throw new Error(`Icon must be exactly 512 x 512 px (yours is ${info.w} x ${info.h}).`);
  }
  return info.url;
}

async function checkShot(file) {
  if (!isImageType(file)) throw new Error(`${file.name}: must be a PNG or JPG file.`);
  if (file.size > LIMITS.shotBytes) throw new Error(`${file.name}: must be 8 MB or smaller.`);
  const info = await loadImage(file).catch(() => {
    throw new Error(`${file.name}: not a valid image.`);
  });
  const lo = Math.min(info.w, info.h);
  const hi = Math.max(info.w, info.h);
  if (lo < 320 || hi > 3840 || hi > 2 * lo) {
    URL.revokeObjectURL(info.url);
    throw new Error(`${file.name}: each side must be 320-3840 px and the long side at most 2x the short side (yours is ${info.w} x ${info.h}).`);
  }
  return info.url;
}

async function checkApk(file) {
  if (!/\.apk$/i.test(file.name)) throw new Error("Please choose a .apk file.");
  if (file.size > LIMITS.apkMB * 1024 * 1024) throw new Error(`APK must be ${LIMITS.apkMB} MB or smaller.`);
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!(head[0] === 0x50 && head[1] === 0x4b)) throw new Error("That does not look like a valid APK file.");
}

/* ---------- network ---------- */

async function authedPost(path, params, token) {
  const r = await fetch(`${WORKER_URL}${path}?${new URLSearchParams(params)}`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
  });
  let body = {};
  try {
    body = await r.json();
  } catch { /* ignore */ }
  if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
  return body;
}

function xhrUpload(path, params, file, contentType, token, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", `${WORKER_URL}${path}?${new URLSearchParams(params)}`);
    x.setRequestHeader("Authorization", "Bearer " + token);
    x.setRequestHeader("Content-Type", contentType);
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded);
    x.onload = () => {
      let body = {};
      try {
        body = JSON.parse(x.responseText);
      } catch { /* ignore */ }
      if (x.status >= 200 && x.status < 300) resolve(body);
      else reject(new Error(body.error || `Upload failed (${x.status})`));
    };
    x.onerror = () => reject(new Error("Network error. Please try again."));
    x.send(file);
  });
}

/* ---------- page ---------- */

export async function renderUpload(el, [existingId], user) {
  if (!user) {
    toast("Please log in first.");
    location.hash = "#/login";
    return;
  }
  if (!me.dev) {
    toast("Become a developer first to publish apps.");
    location.hash = "#/become-developer";
    return;
  }
  if (!user.emailVerified) {
    render(el, html`<div class="empty"><h2>Verify your email first</h2>
      <p>Enter the 6-digit code we email to <b>${user.email}</b>, then come back here.</p>
      <p><a class="btn" href="#/verify">Enter email code</a></p></div>`);
    return;
  }

  const S = {
    step: 1,
    appId: existingId || null,
    data: { name: "", shortDesc: "", fullDesc: "", category: CATEGORIES[0], appType: "app", contactEmail: user.email || "", privacyUrl: "" },
    whatsNew: "",
    status: "draft",
    icon: null, // { file, url }
    shots: [], // [{ file, url }]
    apk: null, // File
    agreed: false,
    busy: false,
  };
  const urls = []; // object URLs to revoke on leave

  if (existingId) {
    const snap = await getDoc(doc(db, "apps", existingId)).catch(() => null);
    if (!snap || !snap.exists() || snap.data().ownerUid !== user.uid || !["draft", "rejected"].includes(snap.data().status)) {
      toast("This app can not be edited.", "err");
      location.hash = "#/dashboard";
      return;
    }
    const d = snap.data();
    S.status = d.status;
    for (const k of Object.keys(S.data)) S.data[k] = d[k] ?? S.data[k];
    S.whatsNew = d.whatsNew || "";
  }

  const stepper = () => html`
    <ol class="stepper">${STEPS.map((s, i) => html`<li class="${i + 1 === S.step ? "active" : i + 1 < S.step ? "done" : ""}"><span>${i + 1}</span>${s}</li>`)}</ol>`;

  const shell = (inner) => {
    render(el, html`<div class="wizard card pad">${stepper()}${inner}</div>`);
  };

  /* ----- step 1 ----- */
  function step1() {
    const d = S.data;
    shell(html`
      <h1>${existingId ? "Edit app" : "Publish a new app"}</h1>
      ${S.status === "rejected" ? html`<div class="notice">This app was rejected. Fix the problems, then submit it again. You will need to choose the files again.</div>` : ""}
      <form id="f" novalidate>
        <label>App name <small>(2-50 characters)</small><input name="name" maxlength="50" value="${d.name}" required></label>
        <label>Short description <small>(5-80 characters)</small><input name="shortDesc" maxlength="80" value="${d.shortDesc}" required></label>
        <label>Full description <small>(what does your app do?)</small><textarea name="fullDesc" rows="6" maxlength="4000">${d.fullDesc}</textarea></label>
        <div class="row">
          <label>Category<select name="category">${CATEGORIES.map((c) => html`<option ${c === d.category ? raw("selected") : ""}>${c}</option>`)}</select></label>
          <label>Type<select name="appType"><option value="app" ${d.appType === "app" ? raw("selected") : ""}>App</option><option value="game" ${d.appType === "game" ? raw("selected") : ""}>Game</option></select></label>
        </div>
        <label>Contact email <small>(shown to users)</small><input name="contactEmail" type="email" maxlength="100" value="${d.contactEmail}" required></label>
        <label>Privacy policy link <small>(optional)</small><input name="privacyUrl" type="url" maxlength="300" placeholder="https://" value="${d.privacyUrl}"></label>
        <p class="muted small">Price: Free. Paid apps are not supported yet.</p>
        <p class="error" id="err" hidden></p>
        <div class="nav-row"><span></span><button class="btn" type="submit">Save & continue</button></div>
      </form>`);

    $("#f").onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      const err = $("#err");
      const fail = (m) => {
        err.textContent = m;
        err.hidden = false;
      };
      const v = {
        name: f.name.value.trim(),
        shortDesc: f.shortDesc.value.trim(),
        fullDesc: f.fullDesc.value.trim(),
        category: f.category.value,
        appType: f.appType.value,
        contactEmail: f.contactEmail.value.trim(),
        privacyUrl: f.privacyUrl.value.trim(),
      };
      if (v.name.length < 2 || v.name.length > 50) return fail("App name must be 2-50 characters.");
      if (v.shortDesc.length < 5 || v.shortDesc.length > 80) return fail("Short description must be 5-80 characters.");
      if (v.fullDesc.length < 20) return fail("Please write a longer description (at least 20 characters).");
      if (!/^\S+@\S+\.\S+$/.test(v.contactEmail)) return fail("Enter a valid contact email.");
      if (v.privacyUrl && !/^https?:\/\//i.test(v.privacyUrl)) return fail("Privacy policy link must start with http:// or https://");

      const btn = f.querySelector("button");
      btn.disabled = true;
      btn.textContent = "Saving…";
      try {
        if (!S.appId) {
          const dev = await getDoc(doc(db, "developers", user.uid));
          if (!dev.exists()) throw new Error("Developer profile not found. Please sign up again.");
          const ref = await addDoc(collection(db, "apps"), {
            ...v,
            ownerUid: user.uid,
            developerName: dev.data().name,
            whatsNew: "",
            status: "draft",
            downloads: 0,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          S.appId = ref.id;
        } else {
          const patch = { ...v, updatedAt: serverTimestamp() };
          if (S.status === "rejected") {
            patch.status = "draft";
            patch.reason = deleteField();
            patch.report = deleteField();
            S.status = "draft";
          }
          await updateDoc(doc(db, "apps", S.appId), patch);
        }
        S.data = v;
        S.step = 2;
        draw();
      } catch (ex) {
        console.error(ex);
        fail(ex.message || "Could not save. Please try again.");
        btn.disabled = false;
        btn.textContent = "Save & continue";
      }
    };
  }

  /* ----- step 2 ----- */
  function step2() {
    shell(html`
      <h1>Graphics</h1>
      <h3>App icon</h3>
      <p class="muted small">PNG or JPG, exactly 512 x 512 px, up to 1 MB.</p>
      ${S.icon ? html`<div class="thumbs"><div class="thumb"><img src="${S.icon.url}" alt="Icon preview"><button type="button" class="x" id="rmIcon" aria-label="Remove icon">×</button></div></div>` : html`<input type="file" id="iconIn" accept="image/png,image/jpeg">`}

      <h3>Screenshots</h3>
      <p class="muted small">${LIMITS.minShots} to ${LIMITS.maxShots} screenshots. PNG or JPG, each side 320-3840 px, the long side at most 2x the short side, up to 8 MB each.</p>
      <div class="thumbs">
        ${S.shots.map((s, i) => html`<div class="thumb"><img src="${s.url}" alt="Screenshot ${i + 1}"><button type="button" class="x" data-rm="${i}" aria-label="Remove screenshot ${i + 1}">×</button></div>`)}
      </div>
      ${S.shots.length < LIMITS.maxShots ? html`<input type="file" id="shotIn" accept="image/png,image/jpeg" multiple>` : ""}
      <p class="error" id="err" hidden></p>
      <div class="nav-row"><button class="btn ghost" id="back" type="button">Back</button><button class="btn" id="next" type="button">Continue</button></div>`);

    const err = $("#err");
    const fail = (m) => {
      err.textContent = m;
      err.hidden = false;
    };
    $("#back").onclick = () => ((S.step = 1), draw());
    $("#next").onclick = () => {
      if (!S.icon) return fail("Please add the app icon.");
      if (S.shots.length < LIMITS.minShots) return fail(`Please add at least ${LIMITS.minShots} screenshots.`);
      S.step = 3;
      draw();
    };
    if ($("#iconIn")) {
      $("#iconIn").onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const url = await checkIcon(file);
          urls.push(url);
          S.icon = { file, url };
          draw();
        } catch (ex) {
          e.target.value = "";
          fail(ex.message);
        }
      };
    }
    if ($("#rmIcon")) $("#rmIcon").onclick = () => ((S.icon = null), draw());
    $$("[data-rm]").forEach((b) => (b.onclick = () => (S.shots.splice(Number(b.dataset.rm), 1), draw())));
    if ($("#shotIn")) {
      $("#shotIn").onchange = async (e) => {
        const files = [...e.target.files].slice(0, LIMITS.maxShots - S.shots.length);
        const problems = [];
        for (const file of files) {
          try {
            const url = await checkShot(file);
            urls.push(url);
            S.shots.push({ file, url });
          } catch (ex) {
            problems.push(ex.message);
          }
        }
        draw();
        if (problems.length) {
          const e2 = $("#err");
          e2.textContent = problems.join(" ");
          e2.hidden = false;
        }
      };
    }
  }

  /* ----- step 3 ----- */
  function step3() {
    shell(html`
      <h1>APK file</h1>
      <p class="muted small">Upload the signed release APK (up to ${LIMITS.apkMB} MB). AAB files are not supported. We check that it is valid, signed and safe.</p>
      ${S.apk
        ? html`<div class="filebox"><b>${S.apk.name}</b> <span class="muted">${fmtSize(S.apk.size)}</span> <button type="button" class="btn small ghost" id="rmApk">Remove</button></div>`
        : html`<input type="file" id="apkIn" accept=".apk,application/vnd.android.package-archive">`}
      <label>What's new <small>(optional, up to 500 characters)</small>
        <textarea id="wn" rows="3" maxlength="500">${S.whatsNew}</textarea></label>
      <p class="error" id="err" hidden></p>
      <div class="nav-row"><button class="btn ghost" id="back" type="button">Back</button><button class="btn" id="next" type="button">Continue</button></div>`);

    const err = $("#err");
    const fail = (m) => {
      err.textContent = m;
      err.hidden = false;
    };
    $("#back").onclick = () => ((S.whatsNew = $("#wn").value), (S.step = 2), draw());
    $("#next").onclick = () => {
      S.whatsNew = $("#wn").value.trim().slice(0, 500);
      if (!S.apk) return fail("Please choose your APK file.");
      S.step = 4;
      draw();
    };
    if ($("#apkIn")) {
      $("#apkIn").onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          await checkApk(file);
          S.whatsNew = $("#wn").value;
          S.apk = file;
          draw();
        } catch (ex) {
          e.target.value = "";
          fail(ex.message);
        }
      };
    }
    if ($("#rmApk")) $("#rmApk").onclick = () => ((S.whatsNew = $("#wn").value), (S.apk = null), draw());
  }

  /* ----- step 4 ----- */
  function step4() {
    const d = S.data;
    shell(html`
      <h1>Review & submit</h1>
      <dl class="info">
        <dt>Name</dt><dd>${d.name}</dd>
        <dt>Short description</dt><dd>${d.shortDesc}</dd>
        <dt>Category</dt><dd>${d.category} · ${d.appType === "game" ? "Game" : "App"}</dd>
        <dt>Contact</dt><dd>${d.contactEmail}</dd>
        <dt>Icon</dt><dd>${S.icon.file.name}</dd>
        <dt>Screenshots</dt><dd>${S.shots.length}</dd>
        <dt>APK</dt><dd>${S.apk.name} (${fmtSize(S.apk.size)})</dd>
      </dl>
      <label class="check"><input type="checkbox" id="agree" ${S.agreed ? raw("checked") : ""}>
        <span>I confirm this app is not malware, I own the rights to it, and I agree to the <a href="#/terms" target="_blank">Developer policy</a>.
        I understand my APK will be scanned by VirusTotal, which shares samples with the security community.</span></label>
      <div id="progress" class="progress" hidden><div class="bar"><div id="barFill"></div></div><p id="progText" class="muted small"></p></div>
      <p class="error" id="err" hidden></p>
      <div class="nav-row"><button class="btn ghost" id="back" type="button">Back</button><button class="btn" id="submit" type="button">Submit for review</button></div>`);

    $("#back").onclick = () => ((S.agreed = $("#agree").checked), (S.step = 3), draw());
    $("#submit").onclick = submit;
  }

  async function submit() {
    const err = $("#err");
    const fail = (m) => {
      err.textContent = m;
      err.hidden = false;
    };
    err.hidden = true;
    S.agreed = $("#agree").checked;
    if (!S.agreed) return fail("Please tick the confirmation box.");
    if (WORKER_URL.includes("__WORKER_URL__")) return fail("The upload service is not connected yet (site not deployed correctly).");

    const btn = $("#submit");
    $("#back").disabled = true;
    btn.disabled = true;
    btn.textContent = "Uploading…";
    $("#progress").hidden = false;

    const files = [
      { kind: "icon", file: S.icon.file, label: "icon" },
      ...S.shots.map((s, i) => ({ kind: "ss" + (i + 1), file: s.file, label: `screenshot ${i + 1}` })),
      { kind: "apk", file: S.apk, label: "APK" },
    ];
    const total = files.reduce((n, f) => n + f.file.size, 0);
    let done = 0;
    const setProg = (extra, label) => {
      const pct = Math.min(100, Math.round(((done + extra) / total) * 100));
      $("#barFill").style.width = pct + "%";
      $("#progText").textContent = `Uploading ${label}… ${pct}%`;
    };

    try {
      await updateDoc(doc(db, "apps", S.appId), { whatsNew: S.whatsNew, updatedAt: serverTimestamp() });
      let token = await auth.currentUser.getIdToken(true);
      await authedPost("/init", { appId: S.appId }, token);
      for (const f of files) {
        token = await auth.currentUser.getIdToken(true);
        setProg(0, f.label);
        await xhrUpload(
          "/upload", { appId: S.appId, kind: f.kind }, f.file,
          f.file.type || "application/octet-stream", token,
          (loaded) => setProg(loaded, f.label)
        );
        done += f.file.size;
      }
      $("#progText").textContent = "Starting the review…";
      token = await auth.currentUser.getIdToken(true);
      await authedPost("/submit", { appId: S.appId }, token);
      finished();
    } catch (ex) {
      console.error(ex);
      fail(ex.message || "Upload failed. Please try again.");
      btn.disabled = false;
      btn.textContent = "Try again";
      $("#back").disabled = false;
    }
  }

  function finished() {
    render(el, html`
      <div class="card pad empty">
        <h1>Submitted! 🎉</h1>
        <p>We started reviewing <b>${S.data.name}</b>. This usually takes a few minutes.</p>
        <p class="muted">You can follow every step live on your dashboard, and we will email you the result.</p>
        <p><a class="btn" href="#/dashboard">Go to my dashboard</a></p>
      </div>`);
  }

  function draw() {
    [step1, step1, step2, step3, step4][S.step]();
    window.scrollTo(0, 0);
  }
  draw();

  return () => urls.forEach((u) => URL.revokeObjectURL(u));
}
