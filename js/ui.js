// ===== ממשק המשתמש וניתוב לפי תפקיד =====
import { login, logout, onAuth } from "./auth.js";
import * as api from "./firestore.js";
import { THRESHOLDS, HISTORY_HOURS } from "./config.js";

// ---------- קבועים ----------
const ROLE_LABELS = { pending: "ממתין לאישור", operator: "מפעיל מנוף", site_manager: "מנהל אתר", admin: "מנהל מערך" };
const USER_STATUS = {
  pending: { label: "ממתין", cls: "bg-amber-100 text-amber-800" },
  approved: { label: "פעיל", cls: "bg-emerald-100 text-emerald-800" },
  rejected: { label: "חסום / נדחה", cls: "bg-red-100 text-red-800" },
};
const CRANE_STATUS = {
  available: { label: "פנוי", cls: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  in_use: { label: "בהפעלה", cls: "bg-amber-100 text-amber-900", dot: "bg-amber-500" },
  maintenance: { label: "מושבת / תחזוקה", cls: "bg-slate-200 text-slate-700", dot: "bg-slate-500" },
};
const PRE_TOGGLES = {
  oilLevelOk: "גובה שמן",
  waterLevelOk: "גובה מים",
  strapsOk: "רצועות",
  shacklesOk: "שקלים",
  trolleyOk: "חתולים / תפסים",
};
const POST_ITEMS = [
  ["craneParked", "מנוף חונה"],
  ["bubaClosed", "בובה סגורה"],
  ["acOff", "מזגן כבוי"],
  ["curtainClosed", "וילון סגור"],
  ["craneLocked", "מנוף נעול"],
];

const $app = document.getElementById("app");
const state = { user: null, profile: null, routeKey: null, subs: [], closing: false };
const knownSites = new Set();

// ---------- כלי עזר ----------
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toDate = (t) => (!t ? null : typeof t.toDate === "function" ? t.toDate() : t instanceof Date ? t : null);
const pad = (n) => String(n).padStart(2, "0");
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function fmtDT(t) {
  const d = toDate(t);
  return d ? d.toLocaleString("he-IL", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
}
function fmtTime(t) {
  const d = toDate(t);
  return d ? d.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) : "—";
}
function fmtDur(ms) {
  if (ms == null || Number.isNaN(ms) || ms < 0) return "—";
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
function opDuration(op) {
  const a = toDate(op.startTime);
  const b = toDate(op.endTime);
  return a && b ? fmtDur(b - a) : null;
}
/** תגית זמן שמתעדכנת כל שנייה */
function since(t, cls = "") {
  const d = toDate(t);
  return d ? `<span data-since="${d.getTime()}" class="tabular-nums ${cls}">${fmtDur(Date.now() - d.getTime())}</span>` : "—";
}
setInterval(() => {
  $$("[data-since]").forEach((el) => { el.textContent = fmtDur(Date.now() - Number(el.dataset.since)); });
}, 1000);

const track = (unsub) => state.subs.push(unsub);
function clearSubs() {
  state.subs.forEach((u) => { try { u(); } catch { /* ignore */ } });
  state.subs = [];
}

function toast(msg, type = "info") {
  const colors = { info: "bg-slate-900", success: "bg-emerald-600", error: "bg-red-600" };
  const el = document.createElement("div");
  el.className = `${colors[type] || colors.info} text-white font-bold px-5 py-3 rounded-xl shadow-xl max-w-md w-full text-center pointer-events-auto transition-opacity`;
  el.textContent = msg;
  $("#toast-root").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; }, type === "error" ? 5000 : 2800);
  setTimeout(() => el.remove(), type === "error" ? 5400 : 3200);
}

function confirmDialog({ title, html = "", confirmText = "אישור", cancelText = "ביטול", danger = false }) {
  return new Promise((resolve) => {
    const root = $("#modal-root");
    root.innerHTML = `
      <div class="fixed inset-0 z-40 bg-slate-900/60 flex items-end sm:items-center justify-center p-4" data-close>
        <div class="bg-white rounded-2xl w-full max-w-md p-5 shadow-2xl" role="dialog" aria-modal="true">
          <h3 class="text-xl font-extrabold mb-3">${esc(title)}</h3>
          <div class="text-slate-700 mb-5">${html}</div>
          <div class="flex gap-3">
            <button class="btn flex-1 ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(confirmText)}</button>
            <button class="btn btn-ghost flex-1" data-cancel>${esc(cancelText)}</button>
          </div>
        </div>
      </div>`;
    const done = (v) => { root.innerHTML = ""; resolve(v); };
    $("[data-ok]", root).onclick = () => done(true);
    $("[data-cancel]", root).onclick = () => done(false);
    $("[data-close]", root).onclick = (e) => { if (e.target.hasAttribute("data-close")) done(false); };
  });
}

function errMsg(e) {
  if (e instanceof api.AppError) return e.message;
  const map = {
    "permission-denied": "אין לך הרשאה לבצע פעולה זו",
    "unavailable": "אין חיבור לשרת — בדוק קליטה ונסה שוב",
    "failed-precondition": "הפעולה נכשלה (ייתכן שחסר אינדקס או שאין חיבור)",
    "auth/network-request-failed": "בעיית רשת — נסה שוב",
    "auth/unauthorized-domain": "הדומיין לא מאושר ב-Firebase Authentication",
  };
  console.error(e);
  return map[e?.code] || `שגיאה: ${e?.message || e}`;
}
const onErr = (e) => toast(errMsg(e), "error");

function rememberSites(list) {
  list.forEach((x) => { const s = (x.site ?? x.assignedSite ?? "").trim(); if (s) knownSites.add(s); });
  const dl = $("#sites-list");
  if (dl) dl.innerHTML = [...knownSites].sort().map((s) => `<option value="${esc(s)}"></option>`).join("");
}

const empty = (text) => `<div class="text-center text-slate-400 py-8 font-semibold">${esc(text)}</div>`;
const spinner = `<div class="flex justify-center py-10"><div class="w-8 h-8 border-4 border-slate-300 border-t-amber-500 rounded-full animate-spin"></div></div>`;

// ---------- מעטפת עמוד ----------
function shell(inner, { wide = true } = {}) {
  const p = state.profile;
  const sub = p?.status === "approved"
    ? `${esc(p.name)} · ${ROLE_LABELS[p.role] || ""}${p.assignedSite ? ` · ${esc(p.assignedSite)}` : ""}`
    : esc(state.user?.email || "");
  $app.innerHTML = `
    <header class="sticky top-0 z-30 bg-slate-900 text-white shadow-lg" style="padding-top: env(safe-area-inset-top)">
      <div class="${wide ? "max-w-6xl" : "max-w-xl"} mx-auto px-4 h-14 flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center text-xl">🏗️</div>
        <div class="flex-1 min-w-0">
          <div class="font-extrabold leading-tight">בקרת מנופים</div>
          <div class="text-xs text-slate-300 truncate">${sub}</div>
        </div>
        <button id="btn-logout" class="text-sm font-bold px-3 py-2 rounded-lg bg-white/10 hover:bg-white/20">יציאה</button>
      </div>
    </header>
    <main class="${wide ? "max-w-6xl" : "max-w-xl"} mx-auto p-4 pb-28">${inner}</main>
    <datalist id="sites-list"></datalist>`;
  $("#btn-logout").onclick = () => logout();
  rememberSites([]);
}

// ---------- ניתוב ----------
let profileUnsub = null;
onAuth((user) => {
  clearSubs();
  profileUnsub?.();
  profileUnsub = null;
  Object.assign(state, { user, profile: null, routeKey: null, closing: false });
  if (!user) return renderLogin();
  $app.innerHTML = spinner;
  profileUnsub = api.watchUserProfile(user.uid, (profile) => {
    state.profile = profile;
    const key = profile ? `${profile.status}|${profile.role}|${profile.assignedSite || ""}` : "none";
    if (key === state.routeKey) return; // שינוי שאינו משפיע על הניתוב
    state.routeKey = key;
    clearSubs();
    route();
  }, onErr);
});

function route() {
  const p = state.profile;
  if (!p) return renderRequestForm();
  if (p.status === "rejected") return renderBlocked();
  if (p.status !== "approved") return renderPending();
  if (p.role === "admin") return renderAdmin();
  if (p.role === "site_manager") return renderSiteManager();
  if (p.role === "operator") return renderOperator();
  return renderPending();
}

// ---------- התחברות ו-Onboarding ----------
const GOOGLE_ICON = `<svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

function renderLogin() {
  $app.innerHTML = `
    <div class="min-h-screen flex items-center justify-center p-6 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-800">
      <div class="w-full max-w-sm text-center text-white">
        <div class="w-20 h-20 mx-auto rounded-3xl bg-amber-500 flex items-center justify-center text-5xl shadow-xl mb-6">🏗️</div>
        <h1 class="text-3xl font-black">בקרת מנופים</h1>
        <p class="text-slate-300 mt-2 mb-10">שליטה ובקרה על הפעלת צמ"ה ברציפים</p>
        <button id="btn-login" class="btn w-full bg-white text-slate-900 text-lg py-4 rounded-2xl shadow-xl hover:bg-slate-100">
          ${GOOGLE_ICON}<span>התחברות עם Google</span>
        </button>
        <p class="text-xs text-slate-400 mt-6">משתמש חדש? לאחר ההתחברות תתבקש למלא בקשת הרשאה</p>
      </div>
    </div>`;
  const btn = $("#btn-login");
  btn.onclick = async () => {
    btn.disabled = true;
    try { await login(); } catch (e) {
      if (!["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(e?.code)) toast(errMsg(e), "error");
      btn.disabled = false;
    }
  };
}

function renderRequestForm() {
  const u = state.user;
  shell(`
    <div class="card">
      <div class="text-4xl mb-2">👋</div>
      <h1 class="text-2xl font-extrabold">בקשת הרשאה למערכת</h1>
      <p class="text-slate-500 mb-5">מלא את הפרטים. הבקשה תועבר לאישור מנהל המערך.</p>
      <form id="req-form" class="space-y-4">
        <div><label class="lbl" for="f-name">שם מלא</label>
          <input id="f-name" name="name" class="inp" required value="${esc(u.displayName || "")}" autocomplete="name"></div>
        <div><label class="lbl" for="f-phone">טלפון</label>
          <input id="f-phone" name="phone" class="inp" type="tel" inputmode="tel" required placeholder="05X-XXXXXXX" dir="ltr" style="text-align:right" autocomplete="tel"></div>
        <div><span class="lbl">תפקיד מבוקש</span>
          <div class="grid grid-cols-2 gap-3">
            ${[["operator", "מפעיל מנוף", "🕹️"], ["site_manager", "מנהל אתר", "📋"]].map(([v, l, i], idx) => `
              <label class="crane-opt cursor-pointer has-[:checked]:border-amber-500 has-[:checked]:bg-amber-50 has-[:checked]:ring-4 has-[:checked]:ring-amber-200">
                <input type="radio" name="requestedRole" value="${v}" class="sr-only" ${idx === 0 ? "checked" : ""}>
                <div class="text-3xl">${i}</div><div class="font-bold mt-1">${l}</div>
              </label>`).join("")}
          </div>
        </div>
        <button class="btn btn-primary btn-xl" type="submit">שלח בקשה</button>
      </form>
    </div>`, { wide: false });
  $("#req-form").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const name = String(fd.get("name")).trim();
    const phone = String(fd.get("phone")).trim();
    if (name.length < 2) return toast("יש להזין שם מלא", "error");
    if (!/^[\d\-+\s()]{9,}$/.test(phone)) return toast("מספר טלפון לא תקין", "error");
    const btn = e.target.querySelector("button[type=submit]");
    btn.disabled = true;
    try {
      await api.createAccessRequest(u, { name, phone, requestedRole: fd.get("requestedRole") });
    } catch (err) { toast(errMsg(err), "error"); btn.disabled = false; }
  };
}

function renderPending() {
  const p = state.profile;
  shell(`
    <div class="card text-center py-10">
      <div class="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center text-3xl mb-4">⏳</div>
      <h1 class="text-2xl font-extrabold">ממתין לאישור מנהל</h1>
      <p class="text-slate-500 mt-2">הבקשה שלך התקבלה. המסך יתעדכן אוטומטית ברגע שתאושר.</p>
      <dl class="mt-6 text-right bg-slate-50 rounded-xl p-4 space-y-1 text-sm">
        <div class="flex justify-between"><dt class="text-slate-500">שם</dt><dd class="font-bold">${esc(p.name)}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">טלפון</dt><dd class="font-bold" dir="ltr">${esc(p.phone)}</dd></div>
        <div class="flex justify-between"><dt class="text-slate-500">תפקיד מבוקש</dt><dd class="font-bold">${esc(ROLE_LABELS[p.requestedRole] || "—")}</dd></div>
      </dl>
    </div>`, { wide: false });
}

function renderBlocked() {
  shell(`
    <div class="card text-center py-10">
      <div class="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center text-3xl mb-4">⛔</div>
      <h1 class="text-2xl font-extrabold">אין גישה למערכת</h1>
      <p class="text-slate-500 mt-2">הבקשה נדחתה או שהחשבון הושבת. לבירור פנה למנהל המערך.</p>
    </div>`, { wide: false });
}

// =====================================================================
// מסך מפעיל
// =====================================================================
function renderOperator() {
  const p = state.profile;
  if (!p.assignedSite) {
    shell(`<div class="card text-center py-10"><div class="text-4xl mb-3">📍</div>
      <h1 class="text-xl font-extrabold">לא שויך לך אתר</h1>
      <p class="text-slate-500 mt-2">פנה למנהל המערך לשיוך לאתר/רציף.</p></div>`, { wide: false });
    return;
  }
  shell(`<div id="op-root">${spinner}</div>`, { wide: false });
  const root = $("#op-root");
  const v = { cranes: [], op: undefined, mode: null, opId: null, selected: null, toggles: {} };

  track(api.watchCranes(p.assignedSite, (list) => {
    v.cranes = list;
    if (v.mode === "pre") drawCraneGrid(v);
  }, onErr));

  track(api.watchMyActiveOperation(state.user.uid, (op) => {
    v.op = op;
    if (!op) {
      state.closing = false;
      if (v.mode !== "pre") mountPreCheck(root, v);
    } else if (state.closing) {
      if (v.mode !== "close" || v.opId !== op.id) mountPostCheck(root, v);
    } else if (v.mode !== "active" || v.opId !== op.id) {
      mountActive(root, v);
    }
  }, onErr));
}

// ----- שלב 1: בדיקת פתיחה -----
function toggleField(name, label) {
  return `
    <div class="flex items-center justify-between gap-3 py-2.5 border-b border-slate-100 last:border-0" data-toggle="${name}">
      <span class="font-bold text-lg">${label}</span>
      <div class="flex gap-2">
        <button type="button" class="tgl" data-val="1">✓ תקין</button>
        <button type="button" class="tgl" data-val="0">✗ לא תקין</button>
      </div>
    </div>`;
}
function levelField(name, label, min) {
  return `
    <div class="py-2.5 border-b border-slate-100">
      <div class="flex items-center justify-between gap-3 mb-2">
        <label class="font-bold text-lg" for="n-${name}">${label}</label>
        <div class="flex items-center gap-1">
          <input id="n-${name}" name="${name}" type="number" inputmode="numeric" min="0" max="100" step="1"
            class="inp w-24 text-center font-extrabold py-2" placeholder="—" data-level="${name}">
          <span class="font-bold text-slate-500">%</span>
        </div>
      </div>
      <input type="range" min="0" max="100" step="5" value="0" class="w-full h-8" data-range="${name}" aria-label="${label}">
      <div class="text-xs text-slate-400">סף התרעה: מתחת ל-${min}%</div>
    </div>`;
}

function mountPreCheck(root, v) {
  Object.assign(v, { mode: "pre", opId: null, selected: null, toggles: {}, submitting: false });
  root.innerHTML = `
    <div class="mb-4">
      <h1 class="text-2xl font-black">פתיחת הפעלה</h1>
      <p class="text-slate-500">אתר: <b>${esc(state.profile.assignedSite)}</b></p>
    </div>
    <form id="pre-form" class="space-y-4" novalidate>
      <section class="card">
        <h2 class="sec-title">1 · בחירת מנוף פנוי</h2>
        <div id="crane-grid" class="grid grid-cols-2 gap-3"></div>
      </section>
      <section class="card space-y-4">
        <h2 class="sec-title !mb-0">2 · מיקום ושעות מנוע</h2>
        <div><label class="lbl" for="f-loc">מיקום עבודה (רציף ספציפי)</label>
          <input id="f-loc" name="workLocation" class="inp" placeholder="לדוגמה: רציף 3 צפון" autocomplete="off"></div>
        <div><label class="lbl" for="f-hours">שעות מנוע</label>
          <input id="f-hours" name="engineHours" class="inp text-left" dir="ltr" type="number" inputmode="decimal" step="0.1" min="0" placeholder="0.0"></div>
      </section>
      <section class="card">
        <h2 class="sec-title">3 · נוזלים</h2>
        ${levelField("fuelLevel", "⛽ דלק", THRESHOLDS.fuelMin)}
        ${levelField("ureaLevel", "💧 אוראה", THRESHOLDS.ureaMin)}
        ${toggleField("oilLevelOk", PRE_TOGGLES.oilLevelOk)}
        ${toggleField("waterLevelOk", PRE_TOGGLES.waterLevelOk)}
      </section>
      <section class="card">
        <h2 class="sec-title">4 · ציוד הרמה</h2>
        ${toggleField("strapsOk", PRE_TOGGLES.strapsOk)}
        ${toggleField("shacklesOk", PRE_TOGGLES.shacklesOk)}
        ${toggleField("trolleyOk", PRE_TOGGLES.trolleyOk)}
      </section>
      <div id="pre-issues"></div>
      <div class="sticky bottom-3 z-10">
        <button type="submit" class="btn btn-primary btn-xl">▶ התחל הפעלה</button>
      </div>
    </form>`;
  drawCraneGrid(v);

  const form = $("#pre-form", root);
  const refresh = () => drawPreIssues(v, form);

  $("#crane-grid", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-crane]");
    if (!b) return;
    v.selected = b.dataset.crane;
    drawCraneGrid(v);
  });
  form.addEventListener("click", (e) => {
    const b = e.target.closest(".tgl");
    if (!b) return;
    const wrap = b.closest("[data-toggle]");
    wrap.dataset.value = b.dataset.val;
    v.toggles[wrap.dataset.toggle] = b.dataset.val === "1";
    refresh();
  });
  form.addEventListener("input", (e) => {
    const r = e.target.dataset.range;
    const n = e.target.dataset.level;
    if (r) form.elements[r].value = e.target.value;
    if (n) { const val = Math.max(0, Math.min(100, Number(e.target.value) || 0)); $(`[data-range="${n}"]`, form).value = val; }
    refresh();
  });
  form.addEventListener("submit", (e) => { e.preventDefault(); submitPreCheck(v, form); });
}

function drawCraneGrid(v) {
  const grid = $("#crane-grid");
  if (!grid) return;
  const avail = v.cranes.filter((c) => c.currentStatus === "available");
  if (v.selected && !avail.some((c) => c.id === v.selected)) {
    if (!v.submitting) toast(`מנוף ${v.selected} אינו פנוי עוד — בחר מנוף אחר`, "error");
    v.selected = null;
  }
  const busy = v.cranes.filter((c) => c.currentStatus !== "available");
  grid.innerHTML = avail.length
    ? avail.map((c) => `
        <button type="button" class="crane-opt" data-crane="${esc(c.id)}" aria-pressed="${c.id === v.selected}">
          <div class="text-xs text-slate-500 font-bold">מנוף</div>
          <div class="text-2xl font-black">${esc(c.craneId)}</div>
        </button>`).join("")
    : `<div class="col-span-2">${empty("אין מנופים פנויים באתר כרגע")}</div>`;
  if (busy.length) {
    grid.insertAdjacentHTML("beforeend", `<div class="col-span-2 flex flex-wrap gap-2 pt-1 text-xs">${busy.map((c) =>
      `<span class="badge ${CRANE_STATUS[c.currentStatus]?.cls}">${esc(c.craneId)} · ${CRANE_STATUS[c.currentStatus]?.label}</span>`).join("")}</div>`);
  }
}

function collectPreCheck(v, form) {
  const num = (n) => (form.elements[n].value === "" ? null : Number(form.elements[n].value));
  const values = {
    workLocation: form.elements.workLocation.value.trim(),
    engineHours: num("engineHours"),
    fuelLevel: num("fuelLevel"),
    ureaLevel: num("ureaLevel"),
  };
  Object.keys(PRE_TOGGLES).forEach((k) => { values[k] = k in v.toggles ? v.toggles[k] : null; });
  const missing = [];
  if (!v.selected) missing.push("בחירת מנוף");
  if (!values.workLocation) missing.push("מיקום עבודה");
  if (values.engineHours == null || values.engineHours < 0) missing.push("שעות מנוע");
  if (values.fuelLevel == null || values.fuelLevel < 0 || values.fuelLevel > 100) missing.push("דלק");
  if (values.ureaLevel == null || values.ureaLevel < 0 || values.ureaLevel > 100) missing.push("אוראה");
  Object.entries(PRE_TOGGLES).forEach(([k, l]) => { if (values[k] == null) missing.push(l); });
  return { values, missing };
}

function drawPreIssues(v, form) {
  const { values } = collectPreCheck(v, form);
  const a = api.analyzePreCheck(values);
  const all = [...a.critical, ...a.equipment];
  $("#pre-issues").innerHTML = all.length ? `
    <div class="rounded-2xl border-2 border-red-300 bg-red-50 p-4">
      <div class="font-extrabold text-red-800 mb-2">⚠️ נמצאו ליקויים — יופיעו כהתרעה אצל מנהל האתר</div>
      <div class="flex flex-wrap gap-2">${issueChips(values)}</div>
    </div>` : "";
}

async function submitPreCheck(v, form) {
  const { values, missing } = collectPreCheck(v, form);
  if (missing.length) {
    toast(`יש להשלים: ${missing.join(", ")}`, "error");
    if (missing.includes("בחירת מנוף")) $("#crane-grid").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const a = api.analyzePreCheck(values);
  if (a.critical.length || a.equipment.length) {
    const ok = await confirmDialog({
      title: "נמצאו ליקויים בבדיקת הפתיחה",
      html: `<div class="flex flex-wrap gap-2 mb-3">${issueChips(values)}</div>
             <p>הליקויים יירשמו ויוצגו כהתרעה למנהל האתר. להתחיל הפעלה בכל זאת?</p>`,
      confirmText: "התחל בכל זאת", danger: true,
    });
    if (!ok) return;
  }
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "פותח הפעלה…";
  v.submitting = true;
  try {
    await api.startOperation({
      craneId: v.selected,
      uid: state.user.uid,
      operatorName: state.profile.name,
      site: state.profile.assignedSite,
      preCheck: values,
    });
    toast("ההפעלה החלה — עבודה בטוחה!", "success");
  } catch (e) {
    toast(errMsg(e), "error");
    btn.disabled = false;
    btn.textContent = "▶ התחל הפעלה";
  } finally {
    v.submitting = false;
  }
}

// ----- שלב 2: הפעלה פעילה -----
function mountActive(root, v) {
  const op = v.op;
  Object.assign(v, { mode: "active", opId: op.id });
  const pc = op.preCheck || {};
  root.innerHTML = `
    <div class="rounded-3xl bg-slate-900 text-white p-6 text-center shadow-xl">
      <div class="inline-flex items-center gap-2 badge bg-emerald-500/20 text-emerald-300 text-sm mb-3">
        <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> הפעלה פעילה
      </div>
      <div class="text-slate-400 text-sm font-bold">מנוף</div>
      <div class="text-5xl font-black mb-4">${esc(op.craneId)}</div>
      <div class="text-slate-400 text-sm font-bold">זמן ריצה</div>
      ${since(op.startTime, "block text-6xl font-black text-amber-400 my-1")}
      <div class="text-slate-400 text-sm">התחלה: ${fmtTime(op.startTime)}</div>
    </div>
    <div class="grid grid-cols-2 gap-3 mt-4">
      <div class="card"><div class="lbl">מיקום ברציף</div><div class="text-xl font-extrabold">${esc(pc.workLocation)}</div></div>
      <div class="card"><div class="lbl">שעות מנוע (פתיחה)</div><div class="text-xl font-extrabold tabular-nums">${esc(pc.engineHours)}</div></div>
      <div class="card"><div class="lbl">דלק</div><div class="text-xl font-extrabold">${esc(pc.fuelLevel)}%</div></div>
      <div class="card"><div class="lbl">אוראה</div><div class="text-xl font-extrabold">${esc(pc.ureaLevel)}%</div></div>
    </div>
    ${(pc.issues || []).length ? `<div class="mt-4 rounded-2xl border-2 border-red-300 bg-red-50 p-4">
      <div class="font-extrabold text-red-800 mb-2">⚠️ ליקויים שדווחו בפתיחה</div>
      <div class="flex flex-wrap gap-2">${issueChips(pc)}</div></div>` : ""}
    <div class="sticky bottom-3 mt-6">
      <button id="btn-end" class="btn btn-danger btn-xl">⏹ סיום הפעלה וטופס סגירה</button>
    </div>`;
  $("#btn-end", root).onclick = () => { state.closing = true; mountPostCheck(root, v); };
}

// ----- שלב 3: בדיקת סגירה -----
function mountPostCheck(root, v) {
  const op = v.op;
  Object.assign(v, { mode: "close", opId: op.id });
  const checks = {};
  root.innerHTML = `
    <div class="mb-4">
      <h1 class="text-2xl font-black">בדיקת סגירה</h1>
      <p class="text-slate-500">מנוף <b>${esc(op.craneId)}</b> · זמן ריצה ${since(op.startTime, "font-bold")}</p>
    </div>
    <section class="space-y-3" id="post-list">
      ${POST_ITEMS.map(([k, l]) => `
        <button type="button" class="chk" data-chk="${k}" aria-pressed="false">
          <span class="box">✓</span><span>${l}</span>
        </button>`).join("")}
    </section>
    <section class="card mt-4">
      <label class="lbl" for="f-notes">הערות נוספות</label>
      <textarea id="f-notes" class="inp min-h-[110px]" placeholder="תקלות, אירועים חריגים, מידע למשמרת הבאה…"></textarea>
    </section>
    <div class="sticky bottom-3 mt-6 grid grid-cols-3 gap-3">
      <button id="btn-back" class="btn btn-ghost py-5 rounded-2xl shadow-lg">חזרה</button>
      <button id="btn-sign" class="btn btn-success btn-xl col-span-2">✍ חתום וסגור הפעלה</button>
    </div>`;

  $("#post-list", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-chk]");
    if (!b) return;
    checks[b.dataset.chk] = !checks[b.dataset.chk];
    b.setAttribute("aria-pressed", String(checks[b.dataset.chk]));
  });
  $("#btn-back", root).onclick = () => { state.closing = false; mountActive(root, v); };
  $("#btn-sign", root).onclick = async (e) => {
    const btn = e.currentTarget;
    const unchecked = POST_ITEMS.filter(([k]) => !checks[k]).map(([, l]) => l);
    if (unchecked.length) {
      const ok = await confirmDialog({
        title: "פריטים לא סומנו",
        html: `<p class="mb-2">הפריטים הבאים לא אומתו:</p>
               <ul class="list-disc pr-5 font-bold text-red-700">${unchecked.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
               <p class="mt-3">לסגור את ההפעלה בכל זאת?</p>`,
        confirmText: "סגור בכל זאת", danger: true,
      });
      if (!ok) return;
    }
    const postCheck = Object.fromEntries(POST_ITEMS.map(([k]) => [k, !!checks[k]]));
    postCheck.notes = $("#f-notes", root).value.trim();
    btn.disabled = true;
    btn.textContent = "סוגר…";
    try {
      await api.closeOperation(op, postCheck);
      state.closing = false;
      toast("ההפעלה נסגרה והמנוף שוחרר", "success");
    } catch (err) {
      toast(errMsg(err), "error");
      btn.disabled = false;
      btn.textContent = "✍ חתום וסגור הפעלה";
    }
  };
}

// =====================================================================
// רכיבי לוח בקרה (משותפים למנהל אתר ולמנהל מערך)
// =====================================================================
function issueChips(pc = {}) {
  const a = api.analyzePreCheck(pc);
  return [
    ...a.critical.map((x) => `<span class="badge bg-red-600 text-white">${esc(x)}</span>`),
    ...a.equipment.map((x) => `<span class="badge bg-orange-500 text-white">${esc(x)}</span>`),
  ].join("");
}
const hasIssues = (op) => {
  const a = api.analyzePreCheck(op.preCheck || {});
  return a.critical.length + a.equipment.length > 0;
};
const opStatusBadge = (op) => (op.status === "active"
  ? `<span class="badge bg-amber-100 text-amber-900"><span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>פעיל</span>`
  : op.postCheck?.forcedClose
    ? `<span class="badge bg-purple-100 text-purple-800">סגירה כפויה</span>`
    : `<span class="badge bg-slate-200 text-slate-700">הושלם</span>`);

function postCheckSummary(op) {
  const pc = op.postCheck;
  if (!pc) return "";
  const missing = POST_ITEMS.filter(([k]) => !pc[k]).map(([, l]) => l);
  return missing.length && !pc.forcedClose
    ? `<span class="text-red-700 text-xs font-bold">לא אומת: ${esc(missing.join(", "))}</span>`
    : pc.forcedClose ? "" : `<span class="text-emerald-700 text-xs font-bold">✓ סגירה מלאה</span>`;
}

function drawAlerts(el, ops) {
  const list = ops.filter(hasIssues);
  el.innerHTML = list.length ? `
    <section class="rounded-2xl border-2 border-red-400 bg-red-50 p-4 mb-6 shadow-sm">
      <h2 class="text-lg font-black text-red-800 mb-3 flex items-center gap-2">🚨 התרעות ופערים קריטיים <span class="badge bg-red-600 text-white">${list.length}</span></h2>
      <div class="grid gap-3 md:grid-cols-2">
        ${list.map((op) => `
          <div class="bg-white rounded-xl border border-red-200 p-3">
            <div class="flex items-center justify-between gap-2 mb-1">
              <div class="font-black text-lg">מנוף ${esc(op.craneId)}</div>${opStatusBadge(op)}
            </div>
            <div class="text-sm text-slate-600 mb-2">${esc(op.operatorName)} · ${esc(op.site)} · ${esc(op.preCheck?.workLocation)} · ${fmtDT(op.startTime)}</div>
            <div class="flex flex-wrap gap-1.5">${issueChips(op.preCheck)}</div>
          </div>`).join("")}
      </div>
    </section>` : `
    <div class="rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 font-bold px-4 py-3 mb-6">✓ אין התרעות פתוחות ב-${HISTORY_HOURS} השעות האחרונות</div>`;
}

function drawActiveCards(el, ops, { showSite = false } = {}) {
  el.innerHTML = ops.length ? ops.map((op) => `
    <div class="card border-r-4 ${hasIssues(op) ? "border-r-red-500" : "border-r-amber-500"}">
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="text-xs text-slate-500 font-bold">מנוף${showSite ? ` · ${esc(op.site)}` : ""}</div>
          <div class="text-2xl font-black">${esc(op.craneId)}</div>
        </div>
        <div class="text-left">
          <div class="text-xs text-slate-500 font-bold">זמן ריצה</div>
          ${since(op.startTime, "text-xl font-black text-amber-600")}
        </div>
      </div>
      <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
        <dt class="text-slate-500">מפעיל</dt><dd class="font-bold">${esc(op.operatorName)}</dd>
        <dt class="text-slate-500">התחלה</dt><dd class="font-bold">${fmtTime(op.startTime)}</dd>
        <dt class="text-slate-500">מיקום</dt><dd class="font-bold">${esc(op.preCheck?.workLocation)}</dd>
        <dt class="text-slate-500">שעות מנוע</dt><dd class="font-bold tabular-nums">${esc(op.preCheck?.engineHours)}</dd>
      </dl>
      ${hasIssues(op) ? `<div class="flex flex-wrap gap-1.5 mt-3">${issueChips(op.preCheck)}</div>` : ""}
      <button class="btn btn-ghost btn-sm w-full mt-3 text-red-700" data-force="${esc(op.id)}">סגירה כפויה</button>
    </div>`).join("") : `<div class="sm:col-span-2 lg:col-span-3 card">${empty("אין מנופים בהפעלה כרגע")}</div>`;
}

function drawFleet(el, cranes, { showSite = false } = {}) {
  const counts = Object.keys(CRANE_STATUS).map((k) => `<span class="badge ${CRANE_STATUS[k].cls}">${CRANE_STATUS[k].label}: ${cranes.filter((c) => c.currentStatus === k).length}</span>`).join("");
  el.innerHTML = `
    <div class="flex flex-wrap gap-2 mb-3">${counts}</div>
    <div class="flex flex-wrap gap-2">${cranes.length ? cranes.map((c) => `
      <div class="flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-3 py-2">
        <span class="w-2.5 h-2.5 rounded-full ${CRANE_STATUS[c.currentStatus]?.dot || "bg-slate-300"}"></span>
        <span class="font-extrabold">${esc(c.craneId)}</span>
        ${showSite ? `<span class="text-xs text-slate-400">${esc(c.site)}</span>` : ""}
      </div>`).join("") : empty("אין מנופים מוגדרים")}</div>`;
}

function drawLog(el, ops, { showSite = false } = {}) {
  if (!ops.length) { el.innerHTML = `<div class="card">${empty("אין הפעלות בטווח הזמן")}</div>`; return; }
  const dur = (op) => (op.status === "active" ? since(op.startTime) : opDuration(op) || "—");
  el.innerHTML = `
    <div class="md:hidden space-y-3">
      ${ops.map((op) => `
        <div class="card !p-3">
          <div class="flex items-center justify-between gap-2">
            <div class="font-black text-lg">מנוף ${esc(op.craneId)}</div>${opStatusBadge(op)}
          </div>
          <div class="text-sm text-slate-600">${esc(op.operatorName)}${showSite ? ` · ${esc(op.site)}` : ""} · ${esc(op.preCheck?.workLocation)}</div>
          <div class="grid grid-cols-3 gap-2 text-sm mt-2">
            <div><div class="text-xs text-slate-400">פתיחה</div><b>${fmtDT(op.startTime)}</b></div>
            <div><div class="text-xs text-slate-400">סגירה</div><b>${op.endTime ? fmtDT(op.endTime) : "—"}</b></div>
            <div><div class="text-xs text-slate-400">משך</div><b class="tabular-nums">${dur(op)}</b></div>
          </div>
          ${hasIssues(op) ? `<div class="flex flex-wrap gap-1.5 mt-2">${issueChips(op.preCheck)}</div>` : ""}
          <div class="mt-1">${postCheckSummary(op)}</div>
          ${op.postCheck?.notes ? `<div class="text-sm bg-slate-50 rounded-lg p-2 mt-2">📝 ${esc(op.postCheck.notes)}</div>` : ""}
        </div>`).join("")}
    </div>
    <div class="hidden md:block card !p-0 overflow-x-auto">
      <table class="w-full">
        <thead><tr>
          <th class="th">מנוף</th>${showSite ? `<th class="th">אתר</th>` : ""}<th class="th">מפעיל</th><th class="th">מיקום</th>
          <th class="th">פתיחה</th><th class="th">סגירה</th><th class="th">משך</th><th class="th">ש' מנוע</th>
          <th class="th">סטטוס</th><th class="th">ליקויים</th><th class="th">סגירה / הערות</th>
        </tr></thead>
        <tbody>
          ${ops.map((op) => `<tr class="${hasIssues(op) ? "bg-red-50/50" : ""}">
            <td class="td font-black">${esc(op.craneId)}</td>${showSite ? `<td class="td">${esc(op.site)}</td>` : ""}
            <td class="td">${esc(op.operatorName)}</td><td class="td">${esc(op.preCheck?.workLocation)}</td>
            <td class="td whitespace-nowrap">${fmtDT(op.startTime)}</td>
            <td class="td whitespace-nowrap">${op.endTime ? fmtDT(op.endTime) : "—"}</td>
            <td class="td tabular-nums">${dur(op)}</td><td class="td tabular-nums">${esc(op.preCheck?.engineHours)}</td>
            <td class="td">${opStatusBadge(op)}</td>
            <td class="td"><div class="flex flex-wrap gap-1">${issueChips(op.preCheck) || `<span class="text-slate-300">—</span>`}</div></td>
            <td class="td max-w-[240px]">${postCheckSummary(op)}${op.postCheck?.notes ? `<div class="text-xs text-slate-600 mt-1">${esc(op.postCheck.notes)}</div>` : ""}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

/** בונה לוח בקרה מלא בתוך container. site ריק = כל האתרים */
function mountDashboard(container, getSite) {
  container.innerHTML = `
    <div id="d-alerts"></div>
    <section class="mb-6">
      <h2 class="sec-title flex items-center gap-2">מנופים בהפעלה כעת <span id="d-active-cnt" class="badge bg-amber-500 text-slate-900"></span></h2>
      <div id="d-active" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"></div>
    </section>
    <section class="mb-6"><h2 class="sec-title">מצב צי המנופים</h2><div id="d-fleet" class="card"></div></section>
    <section><h2 class="sec-title">יומן ${HISTORY_HOURS} שעות אחרונות</h2><div id="d-log">${spinner}</div></section>`;
  const v = { cranes: [], active: [], recent: [], ops: new Map() };

  const draw = () => {
    const site = getSite();
    const inSite = (x) => !site || x.site === site;
    const showSite = !site;
    const cutoff = Date.now() - HISTORY_HOURS * 3600e3;
    const active = v.active.filter(inSite);
    const recent = v.recent.filter((o) => inSite(o) && (toDate(o.startTime)?.getTime() || Date.now()) >= cutoff);
    const merged = new Map([...recent, ...active].map((o) => [o.id, o]));
    v.ops = merged;
    const alertOps = [...merged.values()].sort((a, b) => (toDate(b.startTime) || 0) - (toDate(a.startTime) || 0));
    drawAlerts($("#d-alerts", container), alertOps);
    $("#d-active-cnt", container).textContent = active.length;
    drawActiveCards($("#d-active", container), active, { showSite });
    drawFleet($("#d-fleet", container), v.cranes.filter(inSite), { showSite });
    drawLog($("#d-log", container), recent, { showSite });
  };

  track(api.watchCranes(null, (l) => { v.cranes = l; rememberSites(l); draw(); }, onErr));
  track(api.watchActiveOperations((l) => { v.active = l; draw(); }, onErr));
  track(api.watchOperationsSince(HISTORY_HOURS, (l) => { v.recent = l; draw(); }, onErr));

  container.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-force]");
    if (!b) return;
    const op = v.ops.get(b.dataset.force);
    if (!op) return;
    const ok = await confirmDialog({
      title: `סגירה כפויה — מנוף ${op.craneId}`,
      html: `<p>ההפעלה של <b>${esc(op.operatorName)}</b> תיסגר ללא בדיקת סגירה של המפעיל, והמנוף ישוחרר.</p>`,
      confirmText: "סגור הפעלה", danger: true,
    });
    if (!ok) return;
    try { await api.forceCloseOperation(op, state.profile.name); toast("ההפעלה נסגרה", "success"); } catch (err) { onErr(err); }
  });
  return { redraw: draw };
}

// =====================================================================
// מסך מנהל אתר
// =====================================================================
function renderSiteManager() {
  const site = state.profile.assignedSite || "";
  shell(`
    <div class="flex items-end justify-between gap-3 mb-5">
      <div><h1 class="text-2xl font-black">לוח בקרה</h1><p class="text-slate-500">${site ? `אתר: <b>${esc(site)}</b>` : "כל האתרים"}</p></div>
      <div class="text-left text-sm text-slate-500"><div class="text-xs">עודכן בזמן אמת</div><span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span></div>
    </div>
    <div id="dash"></div>`);
  mountDashboard($("#dash"), () => site);
}

// =====================================================================
// מסך מנהל מערך
// =====================================================================
function renderAdmin() {
  shell(`
    <div id="pending-banner"></div>
    <nav class="flex gap-1 overflow-x-auto bg-slate-200/70 rounded-2xl p-1 mb-5" role="tablist">
      <button class="tab" data-tab="overview" role="tab">📊 תמונת מצב</button>
      <button class="tab" data-tab="users" role="tab">👥 משתמשים <span id="tab-pending-cnt"></span></button>
      <button class="tab" data-tab="cranes" role="tab">🏗️ מנופים</button>
      <button class="tab" data-tab="history" role="tab">🗂️ היסטוריה</button>
    </nav>
    <section data-panel="overview">
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <label class="font-bold text-slate-600" for="ov-site">אתר:</label>
        <select id="ov-site" class="inp-sm !w-auto min-w-[160px]"><option value="">כל האתרים</option></select>
      </div>
      <div id="ov-dash"></div>
    </section>
    <section data-panel="users" hidden></section>
    <section data-panel="cranes" hidden>
      <form id="crane-add" class="card mb-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end">
        <div><label class="lbl" for="ca-id">מזהה / מספר מנוף</label><input id="ca-id" class="inp" required placeholder="לדוגמה: 14"></div>
        <div><label class="lbl" for="ca-site">אתר / רציף</label><input id="ca-site" class="inp" required list="sites-list" placeholder="שם האתר"></div>
        <button class="btn btn-primary h-[52px]">+ הוסף מנוף</button>
      </form>
      <div id="crane-list">${spinner}</div>
    </section>
    <section data-panel="history" hidden></section>`);

  const v = { tab: "overview", users: [], cranes: [] };

  // --- טאבים
  const setTab = (t) => {
    v.tab = t;
    $$("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    $$("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== t; });
  };
  $$("[data-tab]").forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
  setTab("overview");

  // --- תמונת מצב
  const siteSel = $("#ov-site");
  const dash = mountDashboard($("#ov-dash"), () => siteSel.value);
  siteSel.onchange = () => dash.redraw();
  const refreshSiteSelect = () => {
    const cur = siteSel.value;
    siteSel.innerHTML = `<option value="">כל האתרים</option>${[...knownSites].sort().map((s) => `<option ${s === cur ? "selected" : ""}>${esc(s)}</option>`).join("")}`;
  };

  // --- משתמשים
  const usersPanel = $('[data-panel="users"]');
  track(api.watchUsers((list) => {
    v.users = list;
    rememberSites(list.map((u) => ({ site: u.assignedSite })));
    refreshSiteSelect();
    const pending = list.filter((u) => u.status === "pending");
    $("#tab-pending-cnt").innerHTML = pending.length ? `<span class="badge bg-red-600 text-white">${pending.length}</span>` : "";
    $("#pending-banner").innerHTML = pending.length ? `
      <button class="w-full text-right rounded-2xl bg-amber-100 border-2 border-amber-400 px-4 py-3 mb-4 font-bold text-amber-900 flex items-center gap-2" id="go-pending">
        🔔 ${pending.length === 1 ? "בקשת הרשאה אחת ממתינה" : `${pending.length} בקשות הרשאה ממתינות`} לאישור <span class="mr-auto underline">לטיפול ←</span>
      </button>` : "";
    $("#go-pending")?.addEventListener("click", () => setTab("users"));
    drawUsersPanel(usersPanel, v);
  }, onErr));
  usersPanel.addEventListener("click", (e) => handleUserAction(e, v));

  // --- מנופים
  track(api.watchCranes(null, (list) => {
    v.cranes = list;
    rememberSites(list);
    refreshSiteSelect();
    drawCraneList($("#crane-list"), list);
  }, onErr));
  $("#crane-add").onsubmit = async (e) => {
    e.preventDefault();
    const id = $("#ca-id").value.trim();
    const site = $("#ca-site").value.trim();
    if (!id || !site) return toast("יש למלא מזהה ואתר", "error");
    try { await api.addCrane({ craneId: id, site }); toast(`מנוף ${id} נוסף`, "success"); $("#ca-id").value = ""; } catch (err) { onErr(err); }
  };
  $("#crane-list").addEventListener("click", handleCraneAction);

  // --- היסטוריה
  mountHistory($('[data-panel="history"]'));
}

// ----- ניהול משתמשים -----
function roleSelect(cur, name = "role") {
  return `<select class="inp-sm" name="${name}">${["operator", "site_manager", "admin"].map((r) =>
    `<option value="${r}" ${r === cur ? "selected" : ""}>${ROLE_LABELS[r]}</option>`).join("")}</select>`;
}

function drawUsersPanel(panel, v) {
  const pending = v.users.filter((u) => u.status === "pending");
  const others = v.users.filter((u) => u.status !== "pending");
  const me = state.user.uid;
  panel.innerHTML = `
    <section class="mb-8">
      <h2 class="sec-title">בקשות ממתינות (${pending.length})</h2>
      ${pending.length ? `<div class="grid gap-3 md:grid-cols-2">${pending.map((u) => `
        <div class="card border-r-4 border-r-amber-500" data-uid="${esc(u.id)}">
          <div class="flex justify-between gap-2">
            <div><div class="font-black text-lg">${esc(u.name)}</div><div class="text-sm text-slate-500">${esc(u.email)}</div></div>
            <div class="text-left text-sm"><div dir="ltr" class="font-bold">${esc(u.phone)}</div><div class="text-xs text-slate-400">${fmtDT(u.createdAt)}</div></div>
          </div>
          <div class="text-sm mt-2">ביקש: <b>${esc(ROLE_LABELS[u.requestedRole] || "—")}</b></div>
          <div class="grid grid-cols-2 gap-2 mt-3">
            <div><label class="lbl">תפקיד</label>${roleSelect(u.requestedRole || "operator")}</div>
            <div><label class="lbl">אתר / רציף</label><input class="inp-sm" name="site" list="sites-list" placeholder="שם אתר"></div>
          </div>
          <div class="flex gap-2 mt-3">
            <button class="btn btn-success btn-sm flex-1" data-act="approve">✓ אשר</button>
            <button class="btn btn-ghost btn-sm flex-1 text-red-700" data-act="reject">✗ דחה</button>
          </div>
        </div>`).join("")}</div>` : `<div class="card">${empty("אין בקשות ממתינות")}</div>`}
    </section>
    <section>
      <h2 class="sec-title">משתמשים קיימים (${others.length})</h2>
      <div class="card !p-0 overflow-x-auto">
        <table class="w-full min-w-[760px]">
          <thead><tr><th class="th">שם</th><th class="th">טלפון</th><th class="th">תפקיד</th><th class="th">אתר</th><th class="th">סטטוס</th><th class="th"></th></tr></thead>
          <tbody>${others.map((u) => `
            <tr data-uid="${esc(u.id)}">
              <td class="td"><div class="font-bold">${esc(u.name)}${u.id === me ? ` <span class="badge bg-slate-200">אני</span>` : ""}</div><div class="text-xs text-slate-500">${esc(u.email)}</div></td>
              <td class="td" dir="ltr" style="text-align:right">${esc(u.phone)}</td>
              <td class="td">${roleSelect(u.role)}</td>
              <td class="td"><input class="inp-sm" name="site" list="sites-list" value="${esc(u.assignedSite)}" placeholder="כל האתרים"></td>
              <td class="td"><span class="badge ${USER_STATUS[u.status]?.cls || ""}">${USER_STATUS[u.status]?.label || esc(u.status)}</span></td>
              <td class="td whitespace-nowrap">
                <button class="btn btn-dark btn-sm" data-act="save">שמור</button>
                ${u.id === me ? "" : u.status === "approved"
                  ? `<button class="btn btn-ghost btn-sm text-red-700" data-act="block">השבת</button>`
                  : `<button class="btn btn-ghost btn-sm text-emerald-700" data-act="unblock">הפעל</button>`}
              </td>
            </tr>`).join("") || `<tr><td class="td" colspan="6">${empty("אין משתמשים")}</td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-slate-500 mt-2">מנהל אתר ללא שיוך אתר רואה את כל האתרים. מפעיל חייב להיות משויך לאתר.</p>
    </section>`;
}

async function handleUserAction(e, v) {
  const b = e.target.closest("[data-act]");
  if (!b) return;
  const row = b.closest("[data-uid]");
  const uid = row.dataset.uid;
  const user = v.users.find((u) => u.id === uid);
  const role = $("[name=role]", row)?.value;
  const site = $("[name=site]", row)?.value.trim() ?? "";
  const act = b.dataset.act;
  try {
    if ((act === "approve" || act === "save") && role === "operator" && !site) return toast("יש לשייך מפעיל לאתר", "error");
    if (act === "approve") {
      await api.approveUser(uid, { role, assignedSite: site }, state.profile.name);
      toast(`${user.name} אושר כ${ROLE_LABELS[role]}`, "success");
    } else if (act === "reject") {
      if (!(await confirmDialog({ title: "דחיית בקשה", html: `לדחות את הבקשה של <b>${esc(user.name)}</b>?`, confirmText: "דחה", danger: true }))) return;
      await api.rejectUser(uid);
      toast("הבקשה נדחתה");
    } else if (act === "save") {
      if (uid === state.user.uid && role !== "admin") {
        if (!(await confirmDialog({ title: "הסרת הרשאת מנהל מערך", html: "אתה עומד להסיר מעצמך הרשאות מנהל מערך. להמשיך?", danger: true }))) return;
      }
      await api.updateUser(uid, { role, assignedSite: site });
      toast("נשמר", "success");
    } else if (act === "block") {
      if (!(await confirmDialog({ title: "השבתת משתמש", html: `<b>${esc(user.name)}</b> ייחסם מגישה למערכת.`, confirmText: "השבת", danger: true }))) return;
      await api.updateUser(uid, { status: "rejected" });
    } else if (act === "unblock") {
      await api.updateUser(uid, { status: "approved", role: user.role === "pending" ? (user.requestedRole || "operator") : user.role });
    }
  } catch (err) { onErr(err); }
}

// ----- ניהול מנופים -----
function drawCraneList(el, cranes) {
  if (!cranes.length) { el.innerHTML = `<div class="card">${empty("עדיין לא הוגדרו מנופים")}</div>`; return; }
  const bySite = {};
  cranes.forEach((c) => { (bySite[c.site || "ללא אתר"] ||= []).push(c); });
  el.innerHTML = Object.keys(bySite).sort().map((site) => `
    <section class="mb-5">
      <h3 class="font-black text-slate-700 mb-2">${esc(site)} <span class="text-slate-400 font-bold text-sm">(${bySite[site].length})</span></h3>
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        ${bySite[site].map((c) => {
          const inUse = c.currentStatus === "in_use";
          return `
          <div class="card !p-3" data-crane-id="${esc(c.id)}">
            <div class="flex items-center justify-between mb-2">
              <div class="text-xl font-black">${esc(c.craneId)}</div>
              <span class="badge ${CRANE_STATUS[c.currentStatus]?.cls}">${CRANE_STATUS[c.currentStatus]?.label || esc(c.currentStatus)}</span>
            </div>
            <div class="grid grid-cols-2 gap-2">
              <input class="inp-sm" name="site" list="sites-list" value="${esc(c.site)}" ${inUse ? "disabled" : ""} aria-label="אתר">
              <select class="inp-sm" name="status" ${inUse ? "disabled" : ""} aria-label="סטטוס">
                ${inUse ? `<option>בהפעלה</option>` : ["available", "maintenance"].map((s) => `<option value="${s}" ${s === c.currentStatus ? "selected" : ""}>${CRANE_STATUS[s].label}</option>`).join("")}
              </select>
            </div>
            <div class="flex gap-2 mt-2">
              <button class="btn btn-dark btn-sm flex-1" data-cact="save" ${inUse ? "disabled" : ""}>שמור</button>
              <button class="btn btn-ghost btn-sm text-red-700" data-cact="delete" ${inUse ? "disabled" : ""}>מחק</button>
            </div>
            ${inUse ? `<div class="text-xs text-slate-500 mt-2">לא ניתן לערוך מנוף בזמן הפעלה</div>` : ""}
          </div>`;
        }).join("")}
      </div>
    </section>`).join("");
}

async function handleCraneAction(e) {
  const b = e.target.closest("[data-cact]");
  if (!b) return;
  const card = b.closest("[data-crane-id]");
  const id = card.dataset.craneId;
  try {
    if (b.dataset.cact === "save") {
      const site = $("[name=site]", card).value.trim();
      if (!site) return toast("יש להזין אתר", "error");
      await api.updateCrane(id, { site, currentStatus: $("[name=status]", card).value });
      toast(`מנוף ${id} עודכן`, "success");
    } else if (b.dataset.cact === "delete") {
      if (!(await confirmDialog({ title: `מחיקת מנוף ${id}`, html: "המנוף יוסר מהמערכת. היסטוריית ההפעלות שלו תישמר.", confirmText: "מחק", danger: true }))) return;
      await api.deleteCrane(id);
      toast("המנוף נמחק");
    }
  } catch (err) { onErr(err); }
}

// ----- היסטוריית הפעלות -----
function mountHistory(panel) {
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date();
  const weekAgo = new Date(Date.now() - 6 * 864e5);
  panel.innerHTML = `
    <form id="h-form" class="card mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6 items-end">
      <div><label class="lbl">מתאריך</label><input type="date" name="from" class="inp-sm" value="${iso(weekAgo)}"></div>
      <div><label class="lbl">עד תאריך</label><input type="date" name="to" class="inp-sm" value="${iso(today)}"></div>
      <div><label class="lbl">אתר</label><input name="site" class="inp-sm" list="sites-list" placeholder="הכל"></div>
      <div><label class="lbl">מנוף</label><input name="crane" class="inp-sm" placeholder="הכל"></div>
      <div><label class="lbl">מפעיל</label><input name="operator" class="inp-sm" placeholder="הכל"></div>
      <label class="flex items-center gap-2 font-bold text-sm py-2"><input type="checkbox" name="issues" class="w-5 h-5 accent-red-600"> רק עם ליקויים</label>
      <div class="sm:col-span-3 lg:col-span-6 flex gap-2">
        <button class="btn btn-dark btn-sm">חפש</button>
        <button type="button" id="h-csv" class="btn btn-ghost btn-sm" disabled>⬇ ייצוא ל-Excel (CSV)</button>
        <span id="h-count" class="self-center text-sm text-slate-500 mr-auto"></span>
      </div>
    </form>
    <div id="h-results">${empty("בחר טווח ולחץ חפש")}</div>`;

  let results = [];
  const form = $("#h-form", panel);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    const from = new Date(`${f.from}T00:00:00`);
    const to = new Date(`${f.to}T23:59:59`);
    if (!(from <= to)) return toast("טווח תאריכים לא תקין", "error");
    $("#h-results", panel).innerHTML = spinner;
    try {
      const list = await api.getOperationsRange(from, to);
      const has = (val, q) => !q || String(val ?? "").toLowerCase().includes(q.trim().toLowerCase());
      results = list.filter((o) => has(o.site, f.site) && has(o.craneId, f.crane) && has(o.operatorName, f.operator) && (!f.issues || hasIssues(o)));
      $("#h-count", panel).textContent = `${results.length} הפעלות${list.length >= 1000 ? " (הוצגו 1000 הראשונות — צמצם טווח)" : ""}`;
      $("#h-csv", panel).disabled = !results.length;
      drawLog($("#h-results", panel), results, { showSite: true });
    } catch (err) { onErr(err); $("#h-results", panel).innerHTML = ""; }
  };
  $("#h-csv", panel).onclick = () => exportCsv(results);
}

function exportCsv(ops) {
  const yn = (b) => (b === true ? "תקין" : b === false ? "לא תקין" : "");
  const vy = (b) => (b ? "כן" : "לא");
  const head = ["מנוף", "אתר", "מפעיל", "מיקום", "פתיחה", "סגירה", "משך", "סטטוס", "שעות מנוע", "דלק %", "אוראה %",
    "שמן", "מים", "רצועות", "שקלים", "חתולים", "ליקויים", "חונה", "בובה סגורה", "מזגן כבוי", "וילון סגור", "נעול", "הערות"];
  const rows = ops.map((o) => {
    const pc = o.preCheck || {};
    const po = o.postCheck || {};
    return [o.craneId, o.site, o.operatorName, pc.workLocation, fmtDT(o.startTime), o.endTime ? fmtDT(o.endTime) : "",
      opDuration(o) || "", o.status === "active" ? "פעיל" : "הושלם", pc.engineHours, pc.fuelLevel, pc.ureaLevel,
      yn(pc.oilLevelOk), yn(pc.waterLevelOk), yn(pc.strapsOk), yn(pc.shacklesOk), yn(pc.trolleyOk),
      [...api.analyzePreCheck(pc).critical, ...api.analyzePreCheck(pc).equipment].join("; "),
      ...(o.postCheck ? POST_ITEMS.map(([k]) => vy(po[k])) : ["", "", "", "", ""]), po.notes || ""];
  });
  const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `crane-operations-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
