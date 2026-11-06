// Turns every <select> into a styled dropdown (the browser's own list can not be styled).
// The real <select> stays in the page (hidden), so forms and code that read it keep working.
const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';
const CHEV = '<svg class="dd-chev" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
let openDd = null;

function closeDd() {
  if (!openDd) return;
  openDd.classList.remove("open");
  openDd.querySelector(".dd-btn").setAttribute("aria-expanded", "false");
  openDd = null;
}

function build(sel) {
  const wrap = document.createElement("div");
  wrap.className = "dd";
  sel.parentNode.insertBefore(wrap, sel);
  wrap.appendChild(sel);
  sel.classList.add("dd-native");
  sel.tabIndex = -1;
  sel.setAttribute("aria-hidden", "true");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "dd-btn";
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  const list = document.createElement("ul");
  list.className = "dd-list";
  list.setAttribute("role", "listbox");
  wrap.append(btn, list);

  const paint = () => {
    const o = sel.options[sel.selectedIndex];
    btn.innerHTML = `<span class="dd-label"></span>${CHEV}`;
    btn.firstChild.textContent = o ? o.textContent : "";
    list.innerHTML = "";
    [...sel.options].forEach((opt, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.dataset.i = i;
      if (i === sel.selectedIndex) { li.className = "sel"; li.setAttribute("aria-selected", "true"); }
      li.innerHTML = `<span></span>${i === sel.selectedIndex ? CHECK : ""}`;
      li.firstChild.textContent = opt.textContent;
      list.appendChild(li);
    });
  };
  paint();

  const choose = (i) => {
    sel.selectedIndex = i;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    paint();
    closeDd();
    btn.focus();
  };
  btn.addEventListener("click", () => {
    const wasOpen = wrap.classList.contains("open");
    closeDd();
    if (wasOpen) return;
    wrap.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
    openDd = wrap;
    list.querySelector(".sel")?.scrollIntoView({ block: "nearest" });
    // open upwards when there is no room below
    const r = wrap.getBoundingClientRect();
    wrap.classList.toggle("up", window.innerHeight - r.bottom < 260 && r.top > 260);
  });
  list.addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (li) choose(Number(li.dataset.i));
  });
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const n = sel.selectedIndex + (e.key === "ArrowDown" ? 1 : -1);
      if (n >= 0 && n < sel.options.length) { sel.selectedIndex = n; sel.dispatchEvent(new Event("change", { bubbles: true })); paint(); }
    }
  });
  sel.addEventListener("change", paint);
}

export function enhanceSelects(root = document) {
  root.querySelectorAll("select:not(.dd-native)").forEach(build);
}

document.addEventListener("click", (e) => { if (openDd && !openDd.contains(e.target)) closeDd(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDd(); });
