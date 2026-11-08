// ===== ממשק המשתמש וניתוב לפי תפקיד =====
import { login, logout, onAuth } from "./auth.js?v=202611082320";
import * as api from "./firestore.js?v=202611082320";
import * as push from "./push.js?v=202611082320";
import { HISTORY_HOURS, DEVELOPER_EMAILS, ADMIN_EMAILS, SITE_URL, APP_VERSION } from "./config.js?v=202611082320";

// ---------- קבועים ----------
const ROLE_LABELS = { pending: "ממתין לאישור", operator: "מפעיל מנוף", site_manager: "מנהל אתר", admin: "מנהל מערך" };
const USER_STATUS = {
  pending: { label: "ממתין", cls: "badge-warn" },
  approved: { label: "פעיל", cls: "badge-ok" },
  rejected: { label: "חסום / נדחה", cls: "bg-red-100 text-red-800" },
};
const CRANE_STATUS = {
  available: { label: "פנוי", cls: "badge-ok", dot: "bg-emerald-500" },
  in_use: { label: "בהפעלה", cls: "badge-warn", dot: "bg-amber-500" },
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

const emailOf = () => (state.user?.email || "").toLowerCase();
const isDeveloper = () => DEVELOPER_EMAILS.map((e) => e.toLowerCase()).includes(emailOf());
const isFixedAdminEmail = (email) => [...DEVELOPER_EMAILS, ...ADMIN_EMAILS].map((e) => e.toLowerCase()).includes(String(email || "").toLowerCase());

/** הפרופיל שהמסך מוצג עבורו (במצב "תצוגה כמשתמש" של המפתח — המשתמש הנצפה) */
const me = () => state.viewAs?.profile || state.profile;
const myUid = () => state.viewAs?.uid || state.user?.uid;

const $app = document.getElementById("app");
const state = { user: null, profile: null, routeKey: null, subs: [], closing: false, viewAs: null };
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

const LOGO = `<span class="w-9 h-9 rounded-[11px] bg-safety inline-flex items-center justify-center shrink-0"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1D2633" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21V3M4 21h7M7 3h14M7 7l4-4M3 3h4M18 3v6"/><path d="M16.5 9h3l-.5 3h-2z" fill="#1D2633"/></svg></span>`;
const ICONS = {
  eye: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  logout: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11"/></svg>`,
  chevron: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
  check: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`,
};

function toast(msg, type = "info") {
  const colors = { info: "bg-ink/95", success: "bg-ink/95", error: "bg-[#B42318]" };
  const el = document.createElement("div");
  el.className = `${colors[type] || colors.info} text-white text-[15px] font-medium px-5 py-3 rounded-full shadow-lg backdrop-blur max-w-md text-center pointer-events-auto transition-opacity`;
  el.textContent = msg;
  $("#toast-root").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; }, type === "error" ? 5000 : 2800);
  setTimeout(() => el.remove(), type === "error" ? 5400 : 3200);
}

function confirmDialog({ title, html = "", confirmText = "אישור", cancelText = "ביטול", danger = false }) {
  return new Promise((resolve) => {
    const root = $("#modal-root");
    root.innerHTML = `
      <div class="fixed inset-0 z-40 bg-ink/40 flex items-end sm:items-center justify-center sm:p-4" data-close>
        <div class="sheet" role="dialog" aria-modal="true">
          <h3 class="text-xl font-bold mb-2">${esc(title)}</h3>
          <div class="text-muted mb-6">${html}</div>
          <div class="grid gap-2">
            <button class="btn btn-xl ${danger ? "btn-danger" : "btn-primary"}" data-ok>${esc(confirmText)}</button>
            <button class="btn btn-xl btn-ghost" data-cancel>${esc(cancelText)}</button>
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
    "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "מפתח ה-API של Firebase חסר או שגוי (js/config.js)",
    "auth/invalid-api-key": "מפתח ה-API של Firebase חסר או שגוי (js/config.js)",
  };
  console.error(e);
  return map[e?.code] || `שגיאה: ${e?.message || e}`;
}
const onErr = (e) => toast(errMsg(e), "error");

// ---------- התראות למשתמש ----------
const DEFAULT_PREFS = { enabled: true, minLevel: "critical", push: false, sound: true };
const getPrefs = () => ({ ...DEFAULT_PREFS, ...(state.profile?.notifyPrefs || {}) });
let swReg = null;
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").then((r) => { swReg = r; }).catch(() => {});
}
function beep(level) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const times = level === "critical" ? 3 : 1;
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = level === "critical" ? 880 : 660;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.3;
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
      o.start(t); o.stop(t + 0.26);
    }
  } catch { /* ignore */ }
}
async function systemNotify(title, body, tag) {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  const opts = { body, tag, renotify: true, dir: "rtl", lang: "he" };
  try {
    if (swReg) await swReg.showNotification(title, opts);
    else new Notification(title, opts);
    return true;
  } catch { return false; }
}
function deliverAlert({ level, title, body, tag, force = false }) {
  if (isDeveloper() && !force) return; // חשבון המפתח לא מקבל התראות
  const prefs = getPrefs();
  if (!force) {
    if (!prefs.enabled) return;
    if (level === "warning" && prefs.minLevel !== "warning") return;
  }
  toast(title, level === "critical" ? "error" : "info");
  if (prefs.sound) beep(level);
  // כשההתראות לטלפון פעילות — השרת שולח את התראת המערכת (גם כשהאתר סגור)
  if (!prefs.push) systemNotify(title, body, tag);
}
function notifyOp(op) {
  const a = api.analyzePreCheck(op.preCheck || {});
  if (!a.level) return;
  deliverAlert({
    level: a.level,
    title: `${a.level === "critical" ? "🚨 התראה חמורה" : "⚠️ התראה ראשונית"} — ${api.unitName(op)}`,
    body: `${op.operatorName} · ${op.site}\n${[...a.critical, ...a.warning].join(" · ")}`,
    tag: op.id,
  });
}

function rememberSites(list) {
  list.forEach((x) => { const s = (x.site ?? x.assignedSite ?? "").trim(); if (s) knownSites.add(s); });
  const dl = $("#sites-list");
  if (dl) dl.innerHTML = [...knownSites].sort().map((s) => `<option value="${esc(s)}"></option>`).join("");
}

/** תגית תוקף לפי הגדרות ההתראות. kind: "inspection" | "license" */
function validityBadge(dateStr, kind, { linked = true, short = false } = {}) {
  if (kind === "inspection" && !linked) return `<span class="badge bg-slate-200 text-slate-600">לא מקושר לתסקיר</span>`;
  const cfg = api.getAlertSettings()[kind];
  const v = api.validity(dateStr, cfg.soonDays);
  const name = kind === "inspection" ? "תסקיר" : "רישיון";
  const d = api.fmtDateStr(api.normDate(dateStr));
  const map = {
    ok: ["badge-ok", short ? `${name} ✓` : `${name} עד ${d}`],
    soon: ["badge-warn", `${name} יפוג ${v.days === 0 ? "היום" : `בעוד ${v.days} ימים`}`],
    expired: [cfg.severity === "critical" ? "badge-crit" : "badge-warn", `${name} פג ${d}`],
    unknown: ["bg-slate-200 text-slate-600", `אין תאריך ${name}`],
  };
  const [cls, text] = map[v.state];
  return `<span class="badge ${cls}" title="${esc(d)}">${esc(text)}</span>`;
}
/** תגיות תוקף לרישיונות שמוגדרים לבדיקה בהגדרות */
function licenseBadges(u) {
  if (!u?.operatorRecordId) return `<span class="badge bg-slate-200 text-slate-600">לא מקושר למנופאי</span>`;
  const cfg = api.getAlertSettings().license;
  return cfg.fields.map((f) => {
    const v = api.validity(u.licenses?.[f], cfg.soonDays);
    const name = api.LICENSE_FIELDS[f];
    const d = api.fmtDateStr(u.licenses?.[f]);
    const map = {
      ok: ["badge-ok", `${name} עד ${d}`],
      soon: ["badge-warn", `${name} יפוג ${v.days === 0 ? "היום" : `בעוד ${v.days} ימים`}`],
      expired: [cfg.severity === "critical" ? "badge-crit" : "badge-warn", `${name} פג ${d}`],
      unknown: ["bg-slate-200 text-slate-600", `אין תאריך ${name}`],
    };
    const [cls, text] = map[v.state];
    return `<span class="badge ${cls}">${esc(text)}</span>`;
  }).join(" ");
}
const licenseBad = (u) => !u.operatorRecordId || api.getAlertSettings().license.fields.some((f) =>
  api.validity(u.licenses?.[f], api.getAlertSettings().license.soonDays).state !== "ok");
const isBad = (dateStr, kind) => ["expired", "soon", "unknown"].includes(api.validity(dateStr, api.getAlertSettings()[kind].soonDays).state);

const empty = (text) => `<div class="text-center text-slate-400 py-8 font-semibold">${esc(text)}</div>`;
const spinner = `<div class="flex justify-center py-10"><div class="w-8 h-8 border-4 border-slate-300 border-t-amber-500 rounded-full animate-spin"></div></div>`;

// ---------- מעטפת עמוד ----------
// ---------- התקנה כאפליקציה ----------
let installPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installPrompt = e; $("#install-banner")?.classList.remove("hidden"); });
window.addEventListener("appinstalled", () => { $("#install-banner")?.remove(); });
const INSTALL_KEY = "crane-control:install-dismissed";
const isStandaloneApp = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOSDevice = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function installBanner() {
  if (isStandaloneApp()) return "";
  try { if (Date.now() < Number(localStorage.getItem(INSTALL_KEY) || 0)) return ""; } catch { /* ignore */ }
  return `
    <div id="install-banner" class="max-w-6xl mx-auto px-4 pt-3">
      <div class="bg-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-[0_1px_2px_rgba(29,38,51,0.06)]">
        ${LOGO}
        <span class="flex-1 text-sm leading-snug"><b class="block">התקן את האפליקציה</b><span class="text-muted">גישה מהירה מהמסך הראשי והתראות לטלפון</span></span>
        <button id="btn-install" class="btn btn-primary btn-sm">התקן</button>
        <button id="btn-install-x" class="px-2 text-xl text-slate-400" aria-label="סגור">×</button>
      </div>
    </div>`;
}
async function doInstall() {
  if (installPrompt) {
    installPrompt.prompt();
    const r = await installPrompt.userChoice.catch(() => null);
    installPrompt = null;
    if (r?.outcome === "accepted") $("#install-banner")?.remove();
    return;
  }
  confirmDialog({
    title: "התקנת האפליקציה",
    html: isIOSDevice()
      ? `<ol class="list-decimal pr-5 space-y-2"><li>פתח את האתר ב-<b>Safari</b></li><li>לחץ על כפתור <b>השיתוף</b> (ריבוע עם חץ למעלה)</li><li>בחר <b>"הוסף למסך הבית"</b> ← הוסף</li><li>פתח מהאייקון שנוצר במסך הבית</li></ol>`
      : `<ol class="list-decimal pr-5 space-y-2"><li>פתח את האתר ב-<b>Chrome</b></li><li>לחץ על התפריט <b>⋮</b> בפינה</li><li>בחר <b>"התקנת אפליקציה"</b> או <b>"הוספה למסך הבית"</b></li></ol>`,
    confirmText: "הבנתי", cancelText: "סגור",
  });
}

function shell(inner, { wide = true } = {}) {
  const p = me();
  const sub = p?.status === "approved"
    ? `${esc(p.name)} · ${ROLE_LABELS[p.role] || ""}${p.assignedSite ? ` · ${esc(p.assignedSite)}` : ""}`
    : esc(state.user?.email || "");
  $app.innerHTML = `
    <header class="sticky top-0 z-30 bg-concrete/85 backdrop-blur-xl border-b border-ink/5" style="padding-top: env(safe-area-inset-top)">
      <div class="${wide ? "max-w-6xl" : "max-w-xl"} mx-auto px-4 h-[60px] flex items-center gap-3">
        ${LOGO}
        <div class="flex-1 min-w-0">
          <div class="font-bold leading-tight">בקרת מנופים</div>
          <div class="text-xs text-muted truncate">${sub}</div>
        </div>
        ${isDeveloper() && state.profile?.status === "approved" ? `<button id="btn-viewas" class="icon-btn" title="תצוגה כמשתמש" aria-label="תצוגה כמשתמש">${ICONS.eye}</button>` : ""}
        <button id="btn-logout" class="icon-btn" title="יציאה" aria-label="יציאה">${ICONS.logout}</button>
      </div>
    </header>
    ${state.viewAs ? `<div class="bg-ink text-white"><div class="max-w-6xl mx-auto px-4 py-2.5 flex items-center gap-2 text-sm">
      <span class="flex-1">תצוגה כ<b>${esc(state.viewAs.label)}</b>. פעולות לא נשמרות.</span>
      <button id="btn-viewas-exit" class="btn btn-sm bg-white text-ink">סיום תצוגה</button></div></div>` : ""}
    ${state.profile?.status === "approved" ? installBanner() : ""}
    <main class="${wide ? "max-w-6xl" : "max-w-xl"} mx-auto px-4 pt-4 pb-32">${inner}
      <div class="text-center text-[11px] text-slate-400 mt-10">גרסה ${APP_VERSION}</div></main>
    <datalist id="sites-list"></datalist>`;
  $("#btn-logout").onclick = () => logout();
  $("#btn-viewas") && ($("#btn-viewas").onclick = openViewAs);
  $("#btn-viewas-exit") && ($("#btn-viewas-exit").onclick = () => { state.viewAs = null; api.setReadOnly(false); state.closing = false; clearSubs(); route(); });
  $("#btn-install") && ($("#btn-install").onclick = doInstall);
  $("#btn-install-x") && ($("#btn-install-x").onclick = () => {
    try { localStorage.setItem(INSTALL_KEY, String(Date.now() + 3 * 864e5)); } catch { /* ignore */ }
    $("#install-banner")?.remove();
  });
  rememberSites([]);
}

// ---------- שיתוף בוואטסאפ ----------
function shareWhatsApp() {
  const text = [
    "🏗️ *בקרת מנופים ומלגזות*",
    "מערכת לפתיחה וסגירה של הפעלות מנוף ומלגזה, בדיקות לפני הפעלה, ובקרה על תוקף תסקירים ורישיונות.",
    "",
    `🔗 ${SITE_URL}`,
    "",
    "*איך מצטרפים:*",
    "1. נכנסים לקישור ומתחברים עם חשבון Google",
    "2. ממלאים בקשת הרשאה (שם, טלפון, ת\"ז)",
    "3. מחכים לאישור מנהל המערך",
    "4. מתקינים כאפליקציה: אייפון ב-Safari ← שיתוף ← הוסף למסך הבית. אנדרואיד ב-Chrome ← ⋮ ← התקנת אפליקציה",
  ].join("\n");
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

// ---------- תצוגה כמשתמש (מפתח בלבד) ----------
async function openViewAs() {
  const root = $("#modal-root");
  root.innerHTML = `
    <div class="fixed inset-0 z-40 bg-ink/40 flex items-end sm:items-center justify-center sm:p-4" data-close>
      <div class="sheet max-h-[88vh] overflow-y-auto">
        <h3 class="text-xl font-bold mb-1">תצוגה כמשתמש</h3>
        <p class="text-sm text-slate-500 mb-3">רואים את האתר בדיוק כמו המשתמש. פעולות הן סימולציה ולא נשמרות.</p>
        <input id="va-q" class="inp-sm mb-3" placeholder="חיפוש מנופאי / אתר">
        <div class="font-bold text-slate-700 mb-2">מנופאים מאתר התסקירים</div>
        <div id="va-ops" class="space-y-3">${spinner}</div>
        <div class="font-bold text-slate-700 mt-5 mb-2">מנהל אתר</div>
        <div class="grid grid-cols-[1fr_auto] gap-2">
          <select id="va-site" class="inp-sm"><option value="">כל האתרים</option>${[...knownSites].sort().map((x) => `<option>${esc(x)}</option>`).join("")}</select>
          <button class="btn btn-ghost btn-sm" data-va="site_manager">צפה כמנהל אתר</button>
        </div>
        <button class="btn btn-ghost w-full mt-5" data-close-btn>ביטול</button>
      </div>
    </div>`;
  const close = () => { root.innerHTML = ""; };
  $("[data-close]", root).onclick = (e) => { if (e.target.hasAttribute("data-close")) close(); };
  $("[data-close-btn]", root).onclick = close;
  const start = (viewAs) => { close(); state.viewAs = viewAs; state.closing = false; clearSubs(); route(); window.scrollTo(0, 0); };
  $("[data-va=site_manager]", root).onclick = () => {
    const site = $("#va-site", root).value;
    start({ uid: "preview-user", label: `מנהל אתר · ${site || "כל האתרים"}`, profile: { name: "מנהל אתר", role: "site_manager", status: "approved", assignedSite: site } });
  };

  try {
    const [ops, sites, users] = await Promise.all([
      api.listOperators(), api.listSites(),
      new Promise((res, rej) => { const u = api.watchUsers((l) => { u(); res(l); }, rej); }),
    ]);
    const rows = ops.map((o) => {
      const site = api.siteNameFor(o.siteId, sites) || "ללא אתר";
      const user = users.find((u) => u.operatorRecordId === o.id && u.status === "approved");
      return { o, site, user };
    });
    const draw = () => {
      const q = $("#va-q", root).value.trim();
      const list = rows.filter((r) => !q || r.o.name.includes(q) || r.site.includes(q));
      const bySite = {};
      list.forEach((r) => { (bySite[r.site] ||= []).push(r); });
      $("#va-ops", root).innerHTML = list.length ? Object.keys(bySite).sort((a, b) => a.localeCompare(b, "he")).map((site) => `
        <div>
          <div class="text-xs font-bold text-slate-500 mb-1">${esc(site)} (${bySite[site].length})</div>
          <div class="space-y-1.5">${bySite[site].map((r) => `
            <button class="w-full text-right rounded-xl border border-slate-200 px-3 py-2 hover:bg-slate-50 flex items-center justify-between gap-2" data-op="${esc(r.o.id)}">
              <span class="font-bold">${esc(r.o.name)}</span>
              <span class="text-xs ${r.user ? "text-emerald-700" : "text-slate-400"}">${r.user ? "רשום" : "טרם נרשם"}</span>
            </button>`).join("")}</div>
        </div>`).join("") : empty("לא נמצאו מנופאים");
      $$("[data-op]", root).forEach((b) => {
        const r = rows.find((x) => x.o.id === b.dataset.op);
        b.onclick = () => start({
          // אם המנופאי רשום — רואים את ההפעלה הפעילה שלו בפועל
          uid: r.user?.id || `preview-op-${r.o.id}`,
          label: `${r.o.name} · מפעיל · ${r.site}`,
          profile: { name: r.o.name, role: "operator", status: "approved", assignedSite: r.user?.assignedSite || (r.site === "ללא אתר" ? "" : r.site), operatorRecordId: r.o.id, licenses: r.o.licenses },
        });
      });
    };
    $("#va-q", root).oninput = draw;
    draw();
  } catch (err) {
    $("#va-ops", root).innerHTML = `<div class="text-sm text-red-700">${esc(errMsg(err))}</div>`;
  }
}

// ---------- ניתוב ----------
let profileUnsub = null;
onAuth((user) => {
  clearSubs();
  profileUnsub?.();
  profileUnsub = null;
  Object.assign(state, { user, profile: null, routeKey: null, closing: false, viewAs: null });
  api.setReadOnly(false);
  if (!user) return renderLogin();
  $app.innerHTML = spinner;
  profileUnsub = api.watchUserProfile(user.uid, (profile) => {
    // חשבונות קבועים מוגדרים אוטומטית כמנהלי מערך
    if (isFixedAdminEmail(user.email) && (profile?.role !== "admin" || profile?.status !== "approved" || !!profile?.developer !== isDeveloper())) {
      api.ensureFixedAdmin(user, profile, { developer: isDeveloper() }).catch(onErr);
      if (!profile) return;
    }
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
  track(api.watchAlertSettings(() => document.dispatchEvent(new Event("alerts-changed")), onErr));
  api.setReadOnly(!!state.viewAs); // במצב תצוגה — נעילת כל הכתיבות למסד
  if (state.viewAs && isDeveloper()) {
    if (state.viewAs.profile.role === "site_manager") return renderSiteManager();
    return renderOperator();
  }
  if (p.role === "admin") return renderAdmin();
  if (p.role === "site_manager") return renderSiteManager();
  if (p.role === "operator") return renderOperator();
  return renderPending();
}

// ---------- התחברות ו-Onboarding ----------
const GOOGLE_ICON = `<svg width="22" height="22" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>`;

function renderLogin() {
  $app.innerHTML = `
    <div class="min-h-[100dvh] flex flex-col items-center justify-center p-6">
      <div class="w-full max-w-sm">
        <div class="w-16 h-16 rounded-[20px] bg-safety flex items-center justify-center mb-8"><svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="#1D2633" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21V3M4 21h7M7 3h14M7 7l4-4M3 3h4M18 3v6"/><path d="M16.5 9h3l-.5 3h-2z" fill="#1D2633"/></svg></div>
        <h1 class="text-[34px] leading-tight font-bold tracking-tight">בקרת מנופים</h1>
        <p class="text-muted text-lg mt-2 mb-12">פתיחה וסגירה של הפעלות מנוף ומלגזה, ובקרה על תסקירים ורישיונות.</p>
        <button id="btn-login" class="btn btn-xl bg-white text-ink shadow-[0_1px_2px_rgba(29,38,51,0.08)] ring-1 ring-ink/10">
          ${GOOGLE_ICON}<span>כניסה עם Google</span>
        </button>
        <p class="text-sm text-muted mt-5">בכניסה הראשונה תתבקש למלא בקשת הרשאה.</p>
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
      <h1 class="text-2xl font-extrabold">בקשת הרשאה למערכת</h1>
      <p class="text-slate-500 mb-5">מלא את הפרטים. הבקשה תועבר לאישור מנהל המערך.</p>
      <form id="req-form" class="space-y-4">
        <div><label class="lbl" for="f-name">שם מלא</label>
          <input id="f-name" name="name" class="inp" required value="${esc(u.displayName || "")}" autocomplete="name"></div>
        <div><label class="lbl" for="f-phone">טלפון</label>
          <input id="f-phone" name="phone" class="inp" type="tel" inputmode="tel" required placeholder="05X-XXXXXXX" dir="ltr" style="text-align:right" autocomplete="tel"></div>
        <div><label class="lbl" for="f-idn">תעודת זהות <span class="font-normal text-slate-400">(לקישור לרשומת המנופאי)</span></label>
          <input id="f-idn" name="idNumber" class="inp" inputmode="numeric" dir="ltr" style="text-align:right" placeholder="9 ספרות"></div>
        <div><span class="lbl">תפקיד מבוקש</span>
          <div class="grid grid-cols-2 gap-3">
            ${[["operator", "מפעיל מנוף", ""], ["site_manager", "מנהל אתר", ""]].map(([v, l, i], idx) => `
              <label class="crane-opt cursor-pointer has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50">
                <input type="radio" name="requestedRole" value="${v}" class="sr-only" ${idx === 0 ? "checked" : ""}>
                <div class="font-semibold">${l}</div>
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
      await api.createAccessRequest(u, { name, phone, requestedRole: fd.get("requestedRole"), idNumber: String(fd.get("idNumber") || "").replace(/\D/g, "") });
    } catch (err) { toast(errMsg(err), "error"); btn.disabled = false; }
  };
}

function renderPending() {
  const p = state.profile;
  shell(`
    <div class="card text-center py-10">
      <div class="w-14 h-14 mx-auto rounded-full bg-[#FDF1DC] flex items-center justify-center mb-5"><span class="w-3 h-3 rounded-full bg-[#B26B00] animate-pulse"></span></div>
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
      <div class="w-14 h-14 mx-auto rounded-full bg-[#FDE8E6] flex items-center justify-center mb-5"><span class="w-3 h-3 rounded-full bg-[#B42318]"></span></div>
      <h1 class="text-2xl font-extrabold">אין גישה למערכת</h1>
      <p class="text-slate-500 mt-2">הבקשה נדחתה או שהחשבון הושבת. לבירור פנה למנהל המערך.</p>
    </div>`, { wide: false });
}

// =====================================================================
// מסך מפעיל — פשוט ומהיר: (1) בחירת כלי → (2) בדיקה והתחלה → פעיל → סגירה
// =====================================================================
const LEVEL_CHIPS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const LOC_KEY = "crane-control:locations";
const recentLocations = () => { try { return JSON.parse(localStorage.getItem(LOC_KEY) || "[]"); } catch { return []; } };
const PARK_KEY = "crane-control:parking";
const recentParking = () => { try { return JSON.parse(localStorage.getItem(PARK_KEY) || "[]"); } catch { return []; } };
function rememberParking(loc) {
  if (state.viewAs) return;
  try { localStorage.setItem(PARK_KEY, JSON.stringify([loc, ...recentParking().filter((x) => x !== loc)].slice(0, 4))); } catch { /* ignore */ }
}
function rememberLocation(loc) {
  try { localStorage.setItem(LOC_KEY, JSON.stringify([loc, ...recentLocations().filter((x) => x !== loc)].slice(0, 4))); } catch { /* ignore */ }
}

function renderOperator() {
  const p = me();
  if (!p.assignedSite) {
    shell(`<div class="card text-center py-10">
      <h1 class="text-xl font-extrabold">לא שויך לך אתר</h1>
      <p class="text-slate-500 mt-2">פנה למנהל המערך לשיוך לאתר.</p></div>`, { wide: false });
    return;
  }
  shell(`<div id="op-root">${spinner}</div>`, { wide: false });
  const root = $("#op-root");
  const v = { cranes: [], op: undefined, mode: null, opId: null, selected: null, toggles: {}, levels: {} };

  let synced = false;
  track(api.watchCranes(p.assignedSite, (list) => {
    v.cranes = list;
    // רענון תאריכי התסקיר מאתר התסקירים בכל כניסה (עדכון שם מופיע כאן מיד)
    if (!synced && !state.viewAs) { synced = true; api.syncCraneInspections(list); }
    if (v.mode === "pick") drawPick(root, v);
    if (v.mode === "check" && !v.submitting && v.started !== v.selected && !v.cranes.some((c) => c.id === v.selected && c.currentStatus === "available")) {
      toast(`${v.selected} כבר אינו פנוי — בחר כלי אחר`, "error");
      mountPick(root, v);
    }
  }, onErr));

  track(api.watchMyActiveOperation(myUid(), (op) => {
    if (v.op?.id === "preview") return; // סימולציה במצב תצוגה
    v.op = op;
    if (!op) {
      state.closing = false;
      if (!["pick", "check"].includes(v.mode)) mountPick(root, v);
    } else if (state.closing) {
      if (v.mode !== "close" || v.opId !== op.id) mountPostCheck(root, v);
    } else if (v.mode !== "active" || v.opId !== op.id) {
      mountActive(root, v);
    }
  }, onErr));
}

// ----- שלב 1: בחירת כלי -----
function mountPick(root, v) {
  Object.assign(v, { mode: "pick", opId: null, selected: null, toggles: {}, levels: {}, submitting: false, started: null });
  drawPick(root, v);
}
function drawPick(root, v) {
  const usable = v.cranes.filter((c) => c.equipmentId && !c.retired);
  const avail = usable.filter((c) => c.currentStatus === "available");
  const busy = usable.filter((c) => c.currentStatus !== "available");
  root.innerHTML = `
    <h1 class="page-title">בחר כלי</h1>
    <div class="flex flex-wrap gap-1.5 mt-2 mb-5">${licenseBadges(me())}</div>
    <div class="sec-title">פנויים באתר ${esc(me().assignedSite)}</div>
    ${avail.length ? `<div class="group-list">${avail.map((c) => `
      <button type="button" class="w-full flex items-center gap-3 px-4 py-3.5 text-right active:bg-slate-50" data-crane="${esc(c.id)}">
        <span class="flex-1 min-w-0">
          <span class="block text-[13px] text-muted">${api.kindOf(c.equipmentType)}</span>
          <span class="block text-2xl font-bold leading-tight tracking-tight">${esc(c.craneId)}</span>
        </span>
        ${validityBadge(c.inspectionUntil, "inspection", { linked: !!c.equipmentId, short: true })}
        <span class="text-slate-300">${ICONS.chevron}</span>
      </button>`).join("")}</div>` : `<div class="card">${empty("אין כלים פנויים באתר כרגע")}</div>`}
    ${busy.length ? `<div class="sec-title mt-6">לא זמינים</div>
      <div class="group-list">${busy.map((c) => `
        <div class="flex items-center justify-between px-4 py-3 text-muted"><span>${api.kindOf(c.equipmentType)} ${esc(c.craneId)}</span><span class="badge ${CRANE_STATUS[c.currentStatus]?.cls}">${CRANE_STATUS[c.currentStatus]?.label}</span></div>`).join("")}</div>` : ""}`;
  $$("[data-crane]", root).forEach((b) => { b.onclick = () => { v.selected = b.dataset.crane; mountCheck(root, v); }; });
}

// ----- שלב 2: בדיקה לפני הפעלה -----
function levelChips(name, label, key) {
  const c = api.getAlertSettings()[key];
  const tone = (n) => (!c.enabled ? "" : n < c.crit ? "lvl-crit" : n < c.warn ? "lvl-warn" : "");
  return `
    <div class="py-3">
      <div class="flex items-baseline justify-between mb-2">
        <span class="text-[17px] font-semibold">${label}</span>
        <span class="text-2xl font-bold tabular-nums" data-level-val="${name}">—</span>
      </div>
      <div class="grid grid-cols-5 gap-1.5" data-level="${name}">
        ${LEVEL_CHIPS.map((n) => `<button type="button" class="lvl ${tone(n)}" data-n="${n}">${n}</button>`).join("")}
      </div>
    </div>`;
}
function toggleRow(name, label) {
  return `
    <div class="flex items-center justify-between gap-2 px-4 py-2.5" data-toggle="${name}">
      <span class="text-[17px]">${label}</span>
      <div class="flex gap-1.5">
        <button type="button" class="tgl" data-val="1">תקין</button>
        <button type="button" class="tgl" data-val="0">לא תקין</button>
      </div>
    </div>`;
}

function mountCheck(root, v) {
  Object.assign(v, { mode: "check", toggles: {}, levels: {} });
  const crane = v.cranes.find((c) => c.id === v.selected);
  const recent = recentLocations();
  root.innerHTML = `
    <button type="button" id="btn-change" class="text-sm font-medium text-muted mb-1 inline-flex items-center gap-1"><span class="rotate-180">${ICONS.chevron}</span>כל הכלים</button>
    <div class="flex items-end justify-between gap-3 mb-5">
      <div>
        <div class="text-sm text-muted">${api.kindOf(crane?.equipmentType)}</div>
        <h1 class="page-title">${esc(v.selected)}</h1>
      </div>
      ${validityBadge(crane?.inspectionUntil, "inspection", { linked: !!crane?.equipmentId, short: true })}
    </div>
    <form id="pre-form" class="space-y-3" novalidate>
      <section class="card space-y-3">
        <div>
          <label class="lbl" for="f-loc">מיקום עבודה</label>
          <input id="f-loc" name="workLocation" class="inp" placeholder="רציף / מיקום" autocomplete="off" value="${esc(recent[0] || "")}">
          ${recent.length > 1 ? `<div class="flex flex-wrap gap-1.5 mt-2">${recent.map((l) => `<button type="button" class="badge bg-slate-100 text-slate-700 !text-sm !py-1.5" data-loc="${esc(l)}">${esc(l)}</button>`).join("")}</div>` : ""}
        </div>
        <div>
          <label class="lbl" for="f-hours">שעות מנוע</label>
          <input id="f-hours" name="engineHours" class="inp text-center text-2xl font-bold" dir="ltr" type="number" inputmode="decimal" step="0.1" min="0" placeholder="0">
        </div>
      </section>
      <section class="card !py-1 divide-y divide-slate-100">
        ${levelChips("fuelLevel", "דלק", "fuel")}
        ${levelChips("ureaLevel", "אוראה", "urea")}
      </section>
      <div class="flex items-center justify-between px-1 pt-2">
        <span class="text-sm font-semibold text-muted">בדיקות לפני הפעלה</span>
        <button type="button" id="btn-all-ok" class="btn btn-success btn-sm">${ICONS.check} הכל תקין</button>
      </div>
      <section class="group-list">
        ${Object.entries(PRE_TOGGLES).map(([k, l]) => toggleRow(k, l)).join("")}
      </section>
      <div id="pre-issues"></div>
      <div class="sticky bottom-3 z-10">
        <button type="submit" class="btn btn-primary btn-xl shadow-lg shadow-ink/20">התחל הפעלה</button>
      </div>
    </form>`;
  window.scrollTo(0, 0);
  const form = $("#pre-form", root);
  const refresh = () => drawPreIssues(v, form);
  refresh();

  $("#btn-change", root).onclick = () => mountPick(root, v);
  $("#btn-all-ok", root).onclick = () => {
    $$("[data-toggle]", form).forEach((w) => { w.dataset.value = "1"; v.toggles[w.dataset.toggle] = true; });
    refresh();
  };
  form.addEventListener("click", (e) => {
    const loc = e.target.closest("[data-loc]");
    if (loc) { form.elements.workLocation.value = loc.dataset.loc; refresh(); return; }
    const lvl = e.target.closest(".lvl");
    if (lvl) {
      const name = lvl.closest("[data-level]").dataset.level;
      v.levels[name] = Number(lvl.dataset.n);
      $$(".lvl", lvl.parentElement).forEach((b) => b.setAttribute("aria-pressed", String(b === lvl)));
      $(`[data-level-val="${name}"]`, form).textContent = `${v.levels[name]}%`;
      refresh();
      return;
    }
    const b = e.target.closest(".tgl");
    if (!b) return;
    const wrap = b.closest("[data-toggle]");
    wrap.dataset.value = b.dataset.val;
    v.toggles[wrap.dataset.toggle] = b.dataset.val === "1";
    refresh();
  });
  form.addEventListener("input", refresh);
  form.addEventListener("submit", (e) => { e.preventDefault(); submitPreCheck(root, v, form); });
  const onAlerts = () => { if (form.isConnected) refresh(); };
  document.addEventListener("alerts-changed", onAlerts);
  track(() => document.removeEventListener("alerts-changed", onAlerts));
}

function collectPreCheck(v, form) {
  const crane = v.cranes.find((c) => c.id === v.selected);
  const hours = form.elements.engineHours.value;
  const values = {
    operatorRecordId: me().operatorRecordId || null,
    licenses: me().licenses || null,
    ...(crane ? { equipmentId: crane.equipmentId || null, inspectionUntil: crane.inspectionUntil || null } : {}),
    workLocation: form.elements.workLocation.value.trim(),
    engineHours: hours === "" ? null : Number(hours),
    fuelLevel: v.levels.fuelLevel ?? null,
    ureaLevel: v.levels.ureaLevel ?? null,
  };
  Object.keys(PRE_TOGGLES).forEach((k) => { values[k] = k in v.toggles ? v.toggles[k] : null; });
  const missing = [];
  if (!values.workLocation) missing.push("מיקום");
  if (values.engineHours == null || values.engineHours < 0) missing.push("שעות מנוע");
  if (values.fuelLevel == null) missing.push("דלק");
  if (values.ureaLevel == null) missing.push("אוראה");
  Object.entries(PRE_TOGGLES).forEach(([k, l]) => { if (values[k] == null) missing.push(l); });
  return { values, missing };
}

function drawPreIssues(v, form) {
  const { values } = collectPreCheck(v, form);
  const a = api.analyzePreCheck(values);
  const crit = a.level === "critical";
  $("#pre-issues").innerHTML = a.level ? `
    <div class="rounded-2xl border ${crit ? "border-red-200 bg-red-50/60" : "border-amber-200 bg-amber-50/60"} p-3">
      <div class="flex flex-wrap gap-1.5">${issueChips(values)}</div>
      ${a.blockers.length ? `<div class="mt-2 rounded-xl bg-[#FDE8E6] text-[#B42318] font-semibold p-3">לא ניתן להתחיל: ${esc(a.blockers.join(", "))}. פנה למנהל.</div>` : ""}
    </div>` : "";
  const btn = form.querySelector("button[type=submit]");
  if (btn && !v.submitting) btn.classList.toggle("opacity-50", a.blockers.length > 0);
}

async function submitPreCheck(root, v, form) {
  const { values, missing } = collectPreCheck(v, form);
  const a = api.analyzePreCheck(values);
  if (a.blockers.length) return toast(`לא ניתן להתחיל: ${a.blockers.join(", ")}`, "error");
  if (missing.length) return toast(`חסר: ${missing.join(", ")}`, "error");
  if (a.level) {
    const ok = await confirmDialog({
      title: a.level === "critical" ? "נמצאו ליקויים חמורים" : "נמצאו ליקויים",
      html: `<div class="flex flex-wrap gap-1.5 mb-3">${issueChips(values)}</div><p>הליקויים יועברו למנהלים. להתחיל בכל זאת?</p>`,
      confirmText: "התחל בכל זאת", danger: true,
    });
    if (!ok) return;
  }
  if (!state.viewAs) rememberLocation(values.workLocation);
  if (state.viewAs) { // מצב תצוגה — סימולציה בלבד, לא נשמר
    const crane = v.cranes.find((c) => c.id === v.selected);
    v.op = { id: "preview", craneId: v.selected, craneKind: api.kindOf(crane?.equipmentType), startTime: new Date(), preCheck: { ...values, issues: [...a.critical, ...a.warning] } };
    toast("מצב תצוגה: ההפעלה לא נשמרה", "info");
    return mountActive(root, v);
  }
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  btn.textContent = "פותח…";
  v.submitting = true;
  try {
    await api.startOperation({
      craneId: v.selected,
      uid: state.user.uid,
      operatorName: me().name,
      site: me().assignedSite,
      preCheck: values,
      operatorRecordId: me().operatorRecordId || null,
    });
    v.started = v.selected; // המנוף תפוס עכשיו על ידינו — לא להתריע "אינו פנוי"
    toast("ההפעלה החלה. עבודה בטוחה!", "success");
  } catch (e) {
    toast(errMsg(e), "error");
    btn.disabled = false;
    btn.textContent = "התחל הפעלה";
  } finally {
    v.submitting = false;
  }
}

// ----- הפעלה פעילה -----
function mountActive(root, v) {
  const op = v.op;
  Object.assign(v, { mode: "active", opId: op.id });
  const pc = op.preCheck || {};
  root.innerHTML = `
    <div class="rounded-[28px] bg-safety text-ink px-6 pt-6 pb-8">
      <div class="flex items-center justify-between">
        <span class="inline-flex items-center gap-2 text-sm font-semibold"><span class="w-2.5 h-2.5 rounded-full bg-ink animate-pulse"></span>בהפעלה</span>
        <span class="text-sm font-medium">החל ב-${fmtTime(op.startTime)}</span>
      </div>
      ${since(op.startTime, "block text-center text-[64px] leading-none font-bold tracking-tight mt-10 mb-3")}
      <div class="text-center text-sm font-medium opacity-70">זמן הפעלה</div>
    </div>
    <div class="group-list mt-4">
      <div class="flex justify-between px-4 py-3.5"><span class="text-muted">כלי</span><b>${esc(op.craneKind || "מנוף")} ${esc(op.craneId)}</b></div>
      <div class="flex justify-between px-4 py-3.5"><span class="text-muted">מיקום</span><b>${esc(pc.workLocation)}</b></div>
      <div class="flex justify-between px-4 py-3.5"><span class="text-muted">שעות מנוע בפתיחה</span><b class="tabular-nums">${esc(pc.engineHours)}</b></div>
    </div>
    ${(pc.issues || []).length ? `<div class="mt-3 flex flex-wrap gap-1.5">${issueChips(pc)}</div>` : ""}
    <div class="fixed bottom-0 inset-x-0 px-4 pt-3 bg-concrete/85 backdrop-blur-xl" style="padding-bottom: calc(env(safe-area-inset-bottom) + 14px)">
      <div class="max-w-xl mx-auto"><button id="btn-end" class="btn btn-primary btn-xl">סיום הפעלה</button></div>
    </div>`;
  $("#btn-end", root).onclick = () => { state.closing = true; mountPostCheck(root, v); };
}

// ----- סגירה -----
function mountPostCheck(root, v) {
  const op = v.op;
  const pc = op.preCheck || {};
  Object.assign(v, { mode: "close", opId: op.id });
  const checks = {};
  root.innerHTML = `
    <h1 class="page-title">סגירת הפעלה</h1>
    <p class="text-muted mt-1 mb-5">${esc(op.craneKind || "מנוף")} ${esc(op.craneId)}, ${since(op.startTime, "font-semibold text-ink")}</p>
    <div class="flex items-center justify-between px-1 mb-2">
      <span class="text-sm font-semibold text-muted">לפני שעוזבים את הכלי</span>
      <button type="button" id="btn-all-done" class="btn btn-success btn-sm">${ICONS.check} הכל בוצע</button>
    </div>
    <section class="group-list" id="post-list">
      ${POST_ITEMS.map(([k, l]) => `
        <button type="button" class="chk" data-chk="${k}" aria-pressed="false"><span class="box">${ICONS.check}</span><span>${esc(l.replace("מנוף", op.craneKind || "מנוף"))}</span></button>
        ${k === "craneParked" ? `
        <div id="park-row" class="px-4 pb-4 pt-1 bg-white" hidden>
          <label class="lbl" for="f-park">איפה ${esc(op.craneKind || "המנוף")} חונה?</label>
          <input id="f-park" class="inp" placeholder="לדוגמה: חניה צפונית, רציף 2" autocomplete="off">
          <div class="flex flex-wrap gap-1.5 mt-2">${[...new Set([pc.workLocation, ...recentParking()].filter(Boolean))].slice(0, 4).map((l) =>
            `<button type="button" class="badge bg-slate-100 text-ink !text-sm !py-1.5" data-park="${esc(l)}">${esc(l)}</button>`).join("")}</div>
        </div>` : ""}`).join("")}
    </section>
    <textarea id="f-notes" class="inp mt-4 min-h-[90px] bg-white" placeholder="הערות (לא חובה)"></textarea>
    <div class="sticky bottom-3 mt-4 grid grid-cols-3 gap-2">
      <button id="btn-back" class="btn btn-xl bg-white text-ink">חזרה</button>
      <button id="btn-sign" class="btn btn-primary btn-xl col-span-2 shadow-lg shadow-ink/20">סגור הפעלה</button>
    </div>`;
  window.scrollTo(0, 0);
  const parkRow = $("#park-row", root);
  const parkInput = $("#f-park", root);
  const setChk = (b, on) => {
    checks[b.dataset.chk] = on;
    b.setAttribute("aria-pressed", String(on));
    if (b.dataset.chk === "craneParked") {
      parkRow.hidden = !on;
      if (on && !parkInput.value) setTimeout(() => parkInput.focus(), 50);
    }
  };
  $("#post-list", root).addEventListener("click", (e) => {
    const chip = e.target.closest("[data-park]");
    if (chip) { parkInput.value = chip.dataset.park; return; }
    const b = e.target.closest("[data-chk]");
    if (b) setChk(b, !checks[b.dataset.chk]);
  });
  $("#btn-all-done", root).onclick = () => $$("[data-chk]", root).forEach((b) => setChk(b, true));
  $("#btn-back", root).onclick = () => { state.closing = false; mountActive(root, v); };
  $("#btn-sign", root).onclick = async (e) => {
    const btn = e.currentTarget;
    const parkedAt = parkInput.value.trim();
    if (checks.craneParked && !parkedAt) {
      toast(`יש לרשום איפה ${op.craneKind || "המנוף"} חונה`, "error");
      parkInput.focus();
      return;
    }
    const unchecked = POST_ITEMS.filter(([k]) => !checks[k]).map(([, l]) => l);
    if (unchecked.length) {
      const ok = await confirmDialog({
        title: "לא סומנו כל הפריטים",
        html: `<ul class="list-disc pr-5 font-bold text-red-700">${unchecked.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p class="mt-3">לסגור בכל זאת?</p>`,
        confirmText: "סגור בכל זאת", danger: true,
      });
      if (!ok) return;
    }
    if (state.viewAs) {
      state.closing = false;
      if (op.id === "preview") { toast("מצב תצוגה: ההפעלה לא נשמרה", "info"); v.op = null; return mountPick(root, v); }
      return toast("מצב תצוגה: לא ניתן לסגור הפעלה אמיתית של משתמש אחר", "error");
    }
    const postCheck = Object.fromEntries(POST_ITEMS.map(([k]) => [k, !!checks[k]]));
    postCheck.notes = $("#f-notes", root).value.trim();
    postCheck.parkedLocation = checks.craneParked ? parkedAt : "";
    if (parkedAt) rememberParking(parkedAt);
    btn.disabled = true;
    btn.textContent = "סוגר…";
    try {
      await api.closeOperation(op, postCheck);
      state.closing = false;
      toast("ההפעלה נסגרה", "success");
    } catch (err) {
      toast(errMsg(err), "error");
      btn.disabled = false;
      btn.textContent = "סגור הפעלה";
    }
  };
}

// =====================================================================
// רכיבי לוח בקרה (משותפים למנהל אתר ולמנהל מערך)
// =====================================================================
function issueChips(pc = {}) {
  const a = api.analyzePreCheck(pc);
  return [
    ...a.critical.map((x) => `<span class="badge badge-crit">${esc(x)}</span>`),
    ...a.warning.map((x) => `<span class="badge badge-warn">${esc(x)}</span>`),
  ].join("");
}
const opLevel = (op) => api.analyzePreCheck(op.preCheck || {}).level;
const hasIssues = (op) => !!opLevel(op);
const LEVEL_BADGE = {
  critical: `<span class="badge badge-crit">חמורה</span>`,
  warning: `<span class="badge badge-warn">ראשונית</span>`,
};
const opStatusBadge = (op) => (op.status === "active"
  ? `<span class="badge badge-warn"><span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>פעיל</span>`
  : op.postCheck?.forcedClose
    ? `<span class="badge bg-purple-100 text-purple-800">סגירה כפויה</span>`
    : `<span class="badge bg-slate-200 text-slate-700">הושלם</span>`);

function postCheckSummary(op) {
  const pc = op.postCheck;
  if (!pc) return "";
  const missing = POST_ITEMS.filter(([k]) => !pc[k]).map(([, l]) => l);
  const park = pc.parkedLocation ? `<div class="text-xs text-muted">חונה ב: <b class="text-ink">${esc(pc.parkedLocation)}</b></div>` : "";
  return (missing.length && !pc.forcedClose
    ? `<span class="text-[#B42318] text-xs font-semibold">לא אומת: ${esc(missing.join(", "))}</span>`
    : pc.forcedClose ? "" : `<span class="text-[#2F7D55] text-xs font-semibold">סגירה מלאה</span>`) + park;
}

function drawAlerts(el, ops) {
  const rank = { critical: 0, warning: 1 };
  const list = ops.filter(hasIssues).sort((a, b) => rank[opLevel(a)] - rank[opLevel(b)]);
  const nCrit = list.filter((o) => opLevel(o) === "critical").length;
  el.innerHTML = list.length ? `
    <section class="card mb-6 ring-1 ring-[#B42318]/15">
      <h2 class="text-lg font-black text-slate-900 mb-3 flex flex-wrap items-center gap-2">התראות
        ${nCrit ? `<span class="badge badge-crit">${nCrit} חמורות</span>` : ""}
        ${list.length - nCrit ? `<span class="badge badge-warn">${list.length - nCrit} ראשוניות</span>` : ""}</h2>
      <div class="grid gap-3 md:grid-cols-2">
        ${list.map((op) => `
          <div class="bg-white rounded-xl border border-red-200 border-r-4 ${opLevel(op) === "critical" ? "border-r-red-600" : "border-r-amber-400"} p-3">
            <div class="flex items-center justify-between gap-2 mb-1">
              <div class="font-black text-lg">${esc(api.unitName(op))}</div><div class="flex gap-1">${LEVEL_BADGE[opLevel(op)]}${opStatusBadge(op)}</div>
            </div>
            <div class="text-sm text-slate-600 mb-2">${esc(op.operatorName)} · ${esc(op.site)} · ${esc(op.preCheck?.workLocation)} · ${fmtDT(op.startTime)}</div>
            <div class="flex flex-wrap gap-1.5">${issueChips(op.preCheck)}</div>
          </div>`).join("")}
      </div>
    </section>` : `
    <div class="rounded-2xl bg-white border border-slate-200 text-slate-500 font-bold px-4 py-3 mb-6">✓ אין התראות פתוחות ב-${HISTORY_HOURS} השעות האחרונות</div>`;
}

function drawActiveCards(el, ops, { showSite = false } = {}) {
  el.innerHTML = ops.length ? ops.map((op) => `
    <div class="card border-r-4 ${opLevel(op) === "critical" ? "border-r-red-500" : opLevel(op) === "warning" ? "border-r-amber-400" : "border-r-slate-200"}">
      <div class="flex items-start justify-between gap-2">
        <div>
          <div class="text-xs text-slate-500 font-bold">${esc(op.craneKind || "מנוף")}${showSite ? ` · ${esc(op.site)}` : ""}</div>
          <div class="text-2xl font-black">${esc(op.craneId)}</div>
        </div>
        <div class="text-left">
          <div class="text-xs text-slate-500 font-bold">זמן ריצה</div>
          ${since(op.startTime, "text-xl font-black text-slate-900")}
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
    </div>`).join("") : `<div class="sm:col-span-2 lg:col-span-3 card">${empty("אין כלים בהפעלה כרגע")}</div>`;
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
        ${validityBadge(c.inspectionUntil, "inspection", { linked: !!c.equipmentId, short: true })}
      </div>`).join("") : empty("אין כלים מוגדרים")}</div>`;
}

function drawLog(el, ops, { showSite = false } = {}) {
  if (!ops.length) { el.innerHTML = `<div class="card">${empty("אין הפעלות בטווח הזמן")}</div>`; return; }
  const dur = (op) => (op.status === "active" ? since(op.startTime) : opDuration(op) || "—");
  el.innerHTML = `
    <div class="md:hidden space-y-3">
      ${ops.map((op) => `
        <div class="card !p-3">
          <div class="flex items-center justify-between gap-2">
            <div class="font-black text-lg">${esc(api.unitName(op))}</div>${opStatusBadge(op)}
          </div>
          <div class="text-sm text-slate-600">${esc(op.operatorName)}${showSite ? ` · ${esc(op.site)}` : ""} · ${esc(op.preCheck?.workLocation)}</div>
          <div class="grid grid-cols-3 gap-2 text-sm mt-2">
            <div><div class="text-xs text-slate-400">פתיחה</div><b>${fmtDT(op.startTime)}</b></div>
            <div><div class="text-xs text-slate-400">סגירה</div><b>${op.endTime ? fmtDT(op.endTime) : "—"}</b></div>
            <div><div class="text-xs text-slate-400">משך</div><b class="tabular-nums">${dur(op)}</b></div>
          </div>
          ${hasIssues(op) ? `<div class="flex flex-wrap gap-1.5 mt-2">${issueChips(op.preCheck)}</div>` : ""}
          <div class="mt-1">${postCheckSummary(op)}</div>
          ${op.postCheck?.notes ? `<div class="text-sm bg-slate-50 rounded-lg p-2 mt-2">${esc(op.postCheck.notes)}</div>` : ""}
        </div>`).join("")}
    </div>
    <div class="hidden md:block card !p-0 overflow-x-auto">
      <table class="w-full">
        <thead><tr>
          <th class="th">כלי</th>${showSite ? `<th class="th">אתר</th>` : ""}<th class="th">מפעיל</th><th class="th">מיקום</th>
          <th class="th">פתיחה</th><th class="th">סגירה</th><th class="th">משך</th><th class="th">ש' מנוע</th>
          <th class="th">סטטוס</th><th class="th">ליקויים</th><th class="th">סגירה / הערות</th>
        </tr></thead>
        <tbody>
          ${ops.map((op) => `<tr class="${opLevel(op) === "critical" ? "bg-red-50/60" : opLevel(op) === "warning" ? "bg-amber-50/60" : ""}">
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
function mountDashboard(container, getSite, { notifyScope = "", getOperators = null } = {}) {
  container.innerHTML = `
    <div id="d-alerts"></div>
    <div id="d-validity"></div>
    <section class="mb-6">
      <h2 class="sec-title flex items-center gap-2">כלים בהפעלה כעת <span id="d-active-cnt" class="badge bg-slate-100 text-slate-700"></span></h2>
      <div id="d-active" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"></div>
    </section>
    <section class="mb-6"><h2 class="sec-title">מצב הכלים</h2><div id="d-fleet" class="card"></div></section>
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
    drawValidity($("#d-validity", container), v.cranes.filter(inSite), getOperators ? getOperators().filter((o) => !site || o.assignedSite === site) : null);
    drawLog($("#d-log", container), recent, { showSite });
  };

  // התראה על הפעלות חדשות עם ליקויים (רק אחרי הטעינה הראשונה של כל מקור)
  const seen = new Set();
  const ready = { active: false, recent: false };
  const scan = (src, list) => {
    list.forEach((o) => {
      if (seen.has(o.id)) return;
      seen.add(o.id);
      if (ready[src] && o.status === "active" && (!notifyScope || o.site === notifyScope)) notifyOp(o);
    });
    ready[src] = true;
  };

  let synced = false;
  track(api.watchCranes(null, (l) => {
    v.cranes = l.filter((c) => !c.retired); rememberSites(v.cranes); draw();
    if (!synced) { synced = true; api.syncCraneInspections(l); } // רענון תאריכי תסקיר מאוסף הציוד
  }, onErr));
  track(api.watchActiveOperations((l) => { scan("active", l); v.active = l; draw(); }, onErr));
  track(api.watchOperationsSince(HISTORY_HOURS, (l) => { scan("recent", l); v.recent = l; draw(); }, onErr));
  document.addEventListener("alerts-changed", draw);
  track(() => document.removeEventListener("alerts-changed", draw));

  container.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-force]");
    if (!b) return;
    const op = v.ops.get(b.dataset.force);
    if (!op) return;
    const ok = await confirmDialog({
      title: `סגירה כפויה — ${api.unitName(op)}`,
      html: `<p>ההפעלה של <b>${esc(op.operatorName)}</b> תיסגר ללא בדיקת סגירה של המפעיל, והמנוף ישוחרר.</p>`,
      confirmText: "סגור הפעלה", danger: true,
    });
    if (!ok) return;
    if (state.viewAs) return toast("מצב תצוגה: הפעולה לא בוצעה", "info");
    try { await api.forceCloseOperation(op, state.profile.name); toast("ההפעלה נסגרה", "success"); } catch (err) { onErr(err); }
  });
  return { redraw: draw };
}

/** תוקף תסקירים (מנופים) ורישיונות (מפעילים — רק כשיש רשימת משתמשים) */
function drawValidity(el, cranes, operators) {
  const badCranes = cranes.filter((c) => !c.equipmentId || isBad(c.inspectionUntil, "inspection"));
  const badOps = (operators || []).filter(licenseBad);
  if (!badCranes.length && !badOps.length) { el.innerHTML = ""; return; }
  el.innerHTML = `
    <section class="card mb-6">
      <h2 class="text-lg font-black text-slate-900 mb-3">תוקף תסקירים ורישיונות</h2>
      <div class="grid gap-4 ${operators ? "md:grid-cols-2" : ""}">
        ${badCranes.length ? `<div>
          <div class="font-bold text-slate-700 mb-2">כלים (${badCranes.length})</div>
          <div class="space-y-2">${badCranes.map((c) => `
            <div class="py-2.5 border-b border-slate-100 last:border-0 flex flex-wrap items-center justify-between gap-2">
              <span><b>${esc(api.unitName(c))}</b> <span class="text-xs text-slate-500">${esc(c.site)}</span></span>
              ${validityBadge(c.inspectionUntil, "inspection", { linked: !!c.equipmentId })}
            </div>`).join("")}</div></div>` : ""}
        ${badOps.length ? `<div>
          <div class="font-bold text-slate-700 mb-2">מנופאים (${badOps.length})</div>
          <div class="space-y-2">${badOps.map((u) => `
            <div class="py-2.5 border-b border-slate-100 last:border-0 flex flex-wrap items-center justify-between gap-2">
              <span><b>${esc(u.name)}</b> <span class="text-xs text-slate-500">${esc(u.assignedSite)}</span></span>
              <span class="flex flex-wrap gap-1">${licenseBadges(u)}</span>
            </div>`).join("")}</div></div>` : ""}
      </div>
    </section>`;
}

// =====================================================================
// מסך מנהל אתר
// =====================================================================
function renderSiteManager() {
  const site = me().assignedSite || "";
  shell(`
    <div class="flex items-end justify-between gap-3 mb-5">
      <div><h1 class="text-2xl font-black">לוח בקרה</h1><p class="text-slate-500">${site ? `אתר: <b>${esc(site)}</b>` : "כל האתרים"}</p></div>
      <div class="text-left text-sm text-slate-500"><div class="text-xs">עודכן בזמן אמת</div><span class="inline-block w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span></div>
    </div>
    <div id="dash"></div>`);
  mountDashboard($("#dash"), () => site, { notifyScope: site });
}

// =====================================================================
// מסך מנהל מערך
// =====================================================================
function renderAdmin() {
  shell(`
    <div id="pending-banner"></div>
    <div class="flex justify-end mb-3">
      <button id="btn-share" class="btn btn-sm bg-white text-slate-700 ring-1 ring-inset ring-slate-200 hover:bg-slate-50">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" class="text-emerald-600" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.2-.2-.5-.3Z"/></svg>
        שתף בוואטסאפ
      </button>
    </div>
    <nav class="fixed bottom-0 inset-x-0 z-30 bg-white/85 backdrop-blur-xl border-t border-ink/5" style="padding-bottom: env(safe-area-inset-bottom)" role="tablist">
      <div class="max-w-6xl mx-auto grid grid-cols-5">
        <button class="tab" data-tab="overview" role="tab"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 13h4v8H3zM10 3h4v18h-4zM17 8h4v13h-4z"/></svg><span>מצב</span></button>
        <button class="tab relative" data-tab="users" role="tab"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-1a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/></svg><span>משתמשים</span><span id="tab-pending-cnt" class="absolute top-1 right-[calc(50%-22px)]"></span></button>
        <button class="tab" data-tab="cranes" role="tab"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V5h3v16M2 21h10M7 5h13M7 9l4-4M20 5v6M18 11h4v3h-4z"/></svg><span>כלים</span></button>
        <button class="tab" data-tab="history" role="tab"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2"/></svg><span>היסטוריה</span></button>
        <button class="tab" data-tab="alerts" role="tab"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a2 2 0 0 0 3.4 0"/></svg><span>התראות</span></button>
      </div>
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
      <div class="card mb-3 flex flex-wrap items-center gap-3">
        <div id="data-status" class="flex-1 text-sm text-slate-600">טוען נתונים ממערכת הציוד…</div>
        <button type="button" id="btn-sync" class="btn btn-dark btn-sm">סנכרן מאתר התסקירים</button>
      </div>
      <p class="text-xs text-slate-500 mb-4">הכלים נלקחים אוטומטית מאתר התסקירים בלבד. כדי להוסיף כלי, מוסיפים אותו שם. כלי שהוסר משם לא יהיה זמין להפעלה.</p>
      <div id="crane-list">${spinner}</div>
    </section>
    <section data-panel="history" hidden></section>
    <section data-panel="alerts" hidden></section>`);

  const v = { tab: "overview", users: [], cranes: [] };

  $("#btn-share").onclick = shareWhatsApp;

  // --- טאבים
  const setTab = (t) => {
    v.tab = t;
    $$("[data-tab]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === t)));
    $$("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== t; });
    window.scrollTo(0, 0);
  };
  $$("[data-tab]").forEach((b) => { b.onclick = () => setTab(b.dataset.tab); });
  setTab("overview");

  // --- תמונת מצב
  const siteSel = $("#ov-site");
  // מנופאים ממערכת הציוד (לפאנל התוקף), במבנה שהפאנל מצפה לו
  const legacyOperators = () => (v.operators || []).map((o) => ({ name: o.name, assignedSite: api.siteNameFor(o.siteId, v.sites), operatorRecordId: o.id, licenses: o.licenses }));
  const dash = mountDashboard($("#ov-dash"), () => siteSel.value, { getOperators: legacyOperators });
  siteSel.onchange = () => dash.redraw();
  const refreshSiteSelect = () => {
    const cur = siteSel.value;
    siteSel.innerHTML = `<option value="">כל האתרים</option>${[...knownSites].sort().map((s) => `<option ${s === cur ? "selected" : ""}>${esc(s)}</option>`).join("")}`;
  };

  // --- משתמשים
  const usersPanel = $('[data-panel="users"]');

  // --- נתונים ממערכת הציוד: ציוד, אתרים, מנופאים (טעינה חד-פעמית + סנכרון כלים)
  Object.assign(v, { operators: null, sites: null, equipment: null, legacyErr: null, cranesLoaded: false, synced: false });
  const drawStatus = () => {
    const el = $("#data-status");
    if (!el) return;
    if (v.legacyErr) { el.innerHTML = `<span class="text-red-700">לא ניתן לקרוא נתונים ממערכת הציוד: ${esc(v.legacyErr)}</span>`; return; }
    if (!v.equipment) { el.textContent = "טוען נתונים ממערכת הציוד…"; return; }
    const rel = v.equipment.filter((e) => api.isRelevantType(e.type)).length;
    const types = [...new Set(v.equipment.map((e) => api.fixTypeName(e.type) || "ללא סוג"))].join(", ");
    el.innerHTML = `ממערכת הציוד: <b>${v.equipment.length}</b> רשומות ציוד, מתוכן <b>${rel}</b> מנופים ומלגזות · <b>${v.sites.length}</b> אתרים · <b>${v.operators.length}</b> מנופאים
      <div class="text-xs text-slate-400 mt-0.5">סוגים שנמצאו: ${esc(types || "—")}</div>`;
  };
  const runSync = async (manual = false) => {
    if (!v.equipment || !v.cranesLoaded) return;
    v.synced = true;
    const r = await api.syncCranesFromEquipment(v.equipment, v.sites, v.cranes);
    if (manual || r.added || r.updated) toast(`סנכרון כלים: ${r.added} נוספו, ${r.updated} עודכנו${r.skipped ? `, ${r.skipped} דולגו` : ""}`, r.added ? "success" : "info");
  };
  const loadLegacy = async () => {
    try {
      const [equipment, ops, sites] = await Promise.all([api.listEquipment(), api.listOperators(), api.listSites()]);
      Object.assign(v, { equipment, operators: ops, sites, legacyErr: null });
      rememberSites(sites.map((x) => ({ site: x.name })));
      refreshSiteSelect();
      api.syncUserLicenses(v.users || [], ops);
      if (!v.synced) runSync();
    } catch (err) {
      v.legacyErr = err?.code === "permission-denied" ? "אין הרשאת קריאה (בדוק שהודבקו חוקי האבטחה העדכניים)" : errMsg(err);
      Object.assign(v, { equipment: v.equipment || [], operators: v.operators || [], sites: v.sites || [] });
    }
    drawStatus(); drawUsersPanel(usersPanel, v); drawCranes(); dash.redraw();
  };
  track(api.watchUsers((list) => {
    v.users = list;
    rememberSites(list.map((u) => ({ site: u.assignedSite })));
    refreshSiteSelect();
    const pending = list.filter((u) => u.status === "pending");
    $("#tab-pending-cnt").innerHTML = pending.length ? `<span class="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold">${pending.length}</span>` : "";
    $("#pending-banner").innerHTML = pending.length ? `
      <button class="w-full text-right rounded-2xl bg-white border border-slate-200 px-4 py-3 mb-4 font-bold text-slate-800 flex items-center gap-2" id="go-pending">
        <span class="w-2 h-2 rounded-full bg-[#B42318]"></span> ${pending.length === 1 ? "בקשת הרשאה אחת ממתינה" : `${pending.length} בקשות הרשאה ממתינות`} לאישור <span class="mr-auto text-muted">לטיפול</span>
      </button>` : "";
    $("#go-pending")?.addEventListener("click", () => setTab("users"));
    drawUsersPanel(usersPanel, v);
    dash.redraw();
  }, onErr));
  usersPanel.addEventListener("click", (e) => handleUserAction(e, v));

  // --- מנופים
  function drawCranes() {
    if (!v.cranes) return;
    drawCraneList($("#crane-list"), v.cranes);
    drawStatus();
  }
  track(api.watchCranes(null, (list) => {
    v.cranes = list;
    v.cranesLoaded = true;
    rememberSites(list);
    refreshSiteSelect();
    drawCranes();
    if (!v.synced) runSync();
  }, onErr));
  loadLegacy();
  $("#btn-sync").onclick = async (e) => {
    e.currentTarget.disabled = true;
    await loadLegacy();
    await runSync(true);
    e.currentTarget.disabled = false;
  };
  $("#crane-list").addEventListener("change", handleCraneAction);

  // --- היסטוריה
  mountHistory($('[data-panel="history"]'));

  // --- הגדרות התראות
  mountAlertSettings($('[data-panel="alerts"]'));

  // רענון שקט של מזהה המכשיר להתראות לטלפון (המזהה עשוי להתחלף מעת לעת)
  if (getPrefs().push && !isDeveloper()) push.currentToken().then((t) => t && api.addPushToken(state.user.uid, t)).catch(() => {});
}

// ----- ניהול משתמשים -----
function roleSelect(cur, name = "role") {
  return `<select class="inp-sm" name="${name}">${["operator", "site_manager", "admin"].map((r) =>
    `<option value="${r}" ${r === cur ? "selected" : ""}>${ROLE_LABELS[r]}</option>`).join("")}</select>`;
}

function matchOperator(v, u) {
  const id = String(u.idNumber || "").replace(/^0+/, "");
  return id && v.operators ? v.operators.find((o) => o.idNumber.replace(/^0+/, "") === id) : null;
}
function operatorOptions(v, selected) {
  if (!v.operators) return `<option value="${esc(selected)}">טוען מנופאים…</option>`;
  return `<option value="">— ללא קישור —</option>${v.operators.map((o) =>
    `<option value="${esc(o.id)}" ${o.id === selected ? "selected" : ""}>${esc(o.name)}${o.idNumber ? ` · ${esc(o.idNumber)}` : ""}</option>`).join("")}`;
}

function drawUsersPanel(panel, v) {
  if (!v.users) return;
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
            <div class="col-span-2"><label class="lbl">רשומת מנופאי (רישיונות)</label>
              <select class="inp-sm" name="operator">${operatorOptions(v, u.operatorRecordId || matchOperator(v, u)?.id || "")}</select>
              ${u.idNumber && matchOperator(v, u) ? `<div class="text-xs text-emerald-700 mt-1">✓ זוהה לפי ת"ז ${esc(u.idNumber)}</div>` : u.idNumber ? `<div class="text-xs text-slate-500 mt-1">ת"ז ${esc(u.idNumber)} — לא נמצאה רשומה תואמת</div>` : ""}</div>
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
        <table class="w-full min-w-[900px]">
          <thead><tr><th class="th">שם</th><th class="th">טלפון</th><th class="th">תפקיד</th><th class="th">אתר</th><th class="th">מנופאי / רישיון</th><th class="th">סטטוס</th><th class="th"></th></tr></thead>
          <tbody>${others.map((u) => `
            <tr data-uid="${esc(u.id)}">
              <td class="td"><div class="font-bold">${esc(u.name)}${u.id === me ? ` <span class="badge bg-slate-200">אני</span>` : ""}${u.developer ? ` <span class="badge bg-slate-100 text-slate-700">מפתח</span>` : isFixedAdminEmail(u.email) ? ` <span class="badge badge-warn">מנהל קבוע</span>` : ""}</div><div class="text-xs text-slate-500">${esc(u.email)}</div></td>
              <td class="td" dir="ltr" style="text-align:right">${esc(u.phone)}</td>
              <td class="td">${roleSelect(u.role)}</td>
              <td class="td"><input class="inp-sm" name="site" list="sites-list" value="${esc(u.assignedSite)}" placeholder="כל האתרים"></td>
              <td class="td"><select class="inp-sm" name="operator">${operatorOptions(v, u.operatorRecordId || "")}</select>
                ${u.role === "operator" ? `<div class="mt-1 flex flex-wrap gap-1">${licenseBadges(u)}</div>` : ""}</td>
              <td class="td"><span class="badge ${USER_STATUS[u.status]?.cls || ""}">${USER_STATUS[u.status]?.label || esc(u.status)}</span></td>
              <td class="td whitespace-nowrap">
                <button class="btn btn-dark btn-sm" data-act="save">שמור</button>
                ${u.id === me || isFixedAdminEmail(u.email) ? "" : u.status === "approved"
                  ? `<button class="btn btn-ghost btn-sm text-red-700" data-act="block">השבת</button>`
                  : `<button class="btn btn-ghost btn-sm text-emerald-700" data-act="unblock">הפעל</button>`}
              </td>
            </tr>`).join("") || `<tr><td class="td" colspan="7">${empty("אין משתמשים")}</td></tr>`}
          </tbody>
        </table>
      </div>
      <p class="text-xs text-slate-500 mt-2">מנהל אתר ללא שיוך אתר רואה את כל האתרים. מפעיל חייב להיות משויך לאתר.</p>
    </section>
    <section class="mt-8">
      <h2 class="sec-title">מנופאים במערכת הציוד (${v.operators ? v.operators.length : "…"})</h2>
      ${!v.operators ? spinner : !v.operators.length ? `<div class="card">${empty("לא נמצאו מנופאים")}</div>` : `
      <div class="card !p-0 overflow-x-auto">
        <table class="w-full min-w-[640px]">
          <thead><tr><th class="th">שם</th><th class="th">אתר</th><th class="th">תוקף</th><th class="th">משתמש במערכת זו</th></tr></thead>
          <tbody>${v.operators.map((o) => {
            const linkedUser = v.users.find((u) => u.operatorRecordId === o.id);
            return `<tr>
              <td class="td font-bold">${esc(o.name)}</td>
              <td class="td">${esc(api.siteNameFor(o.siteId, v.sites) || "—")}</td>
              <td class="td"><div class="flex flex-wrap gap-1">${licenseBadges({ operatorRecordId: o.id, licenses: o.licenses })}</div></td>
              <td class="td">${linkedUser ? `<span class="badge badge-ok">${esc(linkedUser.name)}</span>` : `<span class="text-xs text-slate-400">טרם נרשם. שתף איתו את האתר בוואטסאפ</span>`}</td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>`}
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
  const opSel = $("[name=operator]", row);
  const operator = v.operators?.find((o) => o.id === opSel?.value) || null;
  const operatorChanged = !!v.operators && (opSel?.value || "") !== (user.operatorRecordId || "");
  const act = b.dataset.act;
  try {
    if ((act === "approve" || act === "save") && role === "operator" && !site) return toast("יש לשייך מפעיל לאתר", "error");
    if (act === "approve") {
      if (role === "operator" && !operator && !(await confirmDialog({ title: "מפעיל ללא רשומת מנופאי", html: "לא נבחרה רשומת מנופאי, ולכן לא ניתן יהיה לבדוק את תוקף הרישיון שלו. לאשר בכל זאת?", confirmText: "אשר בכל זאת" }))) return;
      await api.approveUser(uid, { role, assignedSite: site, operator }, state.profile.name);
      toast(`${user.name} אושר כ${ROLE_LABELS[role]}`, "success");
    } else if (act === "reject") {
      if (!(await confirmDialog({ title: "דחיית בקשה", html: `לדחות את הבקשה של <b>${esc(user.name)}</b>?`, confirmText: "דחה", danger: true }))) return;
      await api.rejectUser(uid);
      toast("הבקשה נדחתה");
    } else if (act === "save") {
      if (uid === state.user.uid && role !== "admin") {
        if (!(await confirmDialog({ title: "הסרת הרשאת מנהל מערך", html: "אתה עומד להסיר מעצמך הרשאות מנהל מערך. להמשיך?", danger: true }))) return;
      }
      await api.updateUser(uid, { role, assignedSite: site, ...(operatorChanged ? api.operatorLinkFields(operator) : {}) });
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
  if (!cranes.length) { el.innerHTML = `<div class="card">${empty("לא נמצאו מנופים או מלגזות באתר התסקירים")}</div>`; return; }
  const active = cranes.filter((c) => !c.retired);
  const retired = cranes.filter((c) => c.retired);
  const bySite = {};
  active.forEach((c) => { (bySite[c.site || "ללא אתר"] ||= []).push(c); });
  el.innerHTML = Object.keys(bySite).sort().map((site) => `
    <section class="mb-5">
      <h3 class="font-black text-slate-700 mb-2">${esc(site)} <span class="text-slate-400 font-bold text-sm">(${bySite[site].length})</span></h3>
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        ${bySite[site].map((c) => {
          const inUse = c.currentStatus === "in_use";
          return `
          <div class="card !p-3" data-crane-id="${esc(c.id)}">
            <div class="flex items-center justify-between gap-2">
              <div><span class="text-xs font-bold text-slate-500">${api.kindOf(c.equipmentType)}</span> <span class="text-xl font-black">${esc(c.craneId)}</span></div>
              ${validityBadge(c.inspectionUntil, "inspection", { linked: !!c.equipmentId, short: true })}
            </div>
            ${c.equipmentLabel ? `<div class="text-xs text-slate-500 mt-1">${esc(c.equipmentLabel)}</div>` : ""}
            <div class="flex items-center gap-2 mt-2">
              <span class="text-sm font-bold text-slate-600">זמינות:</span>
              ${inUse ? `<span class="badge ${CRANE_STATUS.in_use.cls}">בהפעלה</span>` : `
              <select class="inp-sm !w-auto flex-1" name="status" aria-label="זמינות">
                ${["available", "maintenance"].map((st) => `<option value="${st}" ${st === c.currentStatus ? "selected" : ""}>${CRANE_STATUS[st].label}</option>`).join("")}
              </select>`}
            </div>
          </div>`;
        }).join("")}
      </div>
    </section>`).join("") + (retired.length ? `
    <section class="mb-5 opacity-70">
      <h3 class="font-black text-slate-500 mb-2">לא קיימים באתר התסקירים (${retired.length})</h3>
      <div class="flex flex-wrap gap-2">${retired.map((c) => `<span class="badge bg-slate-200 text-slate-600">${esc(c.craneId)} · ${esc(c.site || "")}</span>`).join("")}</div>
      <p class="text-xs text-slate-500 mt-1">כלים אלה לא זמינים להפעלה. הם נשמרים רק לצורך ההיסטוריה.</p>
    </section>` : "");
}

async function handleCraneAction(e) {
  const sel = e.target.closest("select[name=status]");
  if (!sel || e.type !== "change") return;
  const id = sel.closest("[data-crane-id]").dataset.craneId;
  try {
    await api.updateCrane(id, { currentStatus: sel.value });
    toast(sel.value === "maintenance" ? `${id} הושבת` : `${id} זמין להפעלה`, "success");
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
      <div><label class="lbl">כלי (מספר)</label><input name="crane" class="inp-sm" placeholder="הכל"></div>
      <div><label class="lbl">מפעיל</label><input name="operator" class="inp-sm" placeholder="הכל"></div>
      <label class="flex items-center gap-2 font-bold text-sm py-2"><input type="checkbox" name="issues" class="w-5 h-5 accent-red-600"> רק עם ליקויים</label>
      <div class="sm:col-span-3 lg:col-span-6 flex gap-2">
        <button class="btn btn-dark btn-sm">חפש</button>
        <button type="button" id="h-csv" class="btn btn-ghost btn-sm" disabled>ייצוא ל-Excel</button>
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
  const head = ["סוג", "כלי", "אתר", "מפעיל", "מיקום", "פתיחה", "סגירה", "משך", "סטטוס", "שעות מנוע", "דלק %", "אוראה %",
    "שמן", "מים", "רצועות", "שקלים", "חתולים", "תסקיר עד", "רישיון עד", "התראות", "חונה", "מיקום חניה", "בובה סגורה", "מזגן כבוי", "וילון סגור", "נעול", "הערות"];
  const rows = ops.map((o) => {
    const pc = o.preCheck || {};
    const po = o.postCheck || {};
    return [o.craneKind || "מנוף", o.craneId, o.site, o.operatorName, pc.workLocation, fmtDT(o.startTime), o.endTime ? fmtDT(o.endTime) : "",
      opDuration(o) || "", o.status === "active" ? "פעיל" : "הושלם", pc.engineHours, pc.fuelLevel, pc.ureaLevel,
      yn(pc.oilLevelOk), yn(pc.waterLevelOk), yn(pc.strapsOk), yn(pc.shacklesOk), yn(pc.trolleyOk),
      api.fmtDateStr(pc.inspectionUntil), pc.licenses ? api.fmtDateStr(pc.licenses.craneLicenseExpiry) : "",
      (({ critical, warning }) => [...critical.map((x) => `חמורה: ${x}`), ...warning.map((x) => `ראשונית: ${x}`)].join("; "))(api.analyzePreCheck(pc)),
      ...(o.postCheck ? [vy(po.craneParked), po.parkedLocation || "", ...POST_ITEMS.slice(1).map(([k]) => vy(po[k]))] : ["", "", "", "", "", ""]), po.notes || ""];
  });
  const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `crane-operations-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// =====================================================================
// הגדרות התראות (מנהל מערך)
// =====================================================================
const SEV_OPTS = [["off", "ללא"], ["warning", "ראשונית"], ["critical", "חמורה"]];

function switchInput(name, checked, label, sub = "") {
  return `
    <label class="flex items-center justify-between gap-4 py-3 cursor-pointer">
      <span><span class="font-bold text-slate-800">${label}</span>${sub ? `<span class="block text-xs text-slate-500">${sub}</span>` : ""}</span>
      <span class="relative shrink-0">
        <input type="checkbox" name="${name}" class="peer sr-only" ${checked ? "checked" : ""}>
        <span class="block w-12 h-7 rounded-full bg-slate-300 transition peer-checked:bg-emerald-600"></span>
        <span class="absolute top-1 right-1 w-5 h-5 rounded-full bg-white shadow transition peer-checked:-translate-x-5"></span>
      </span>
    </label>`;
}

function levelRow(key, label, cfg) {
  return `
    <div class="py-4 border-b border-slate-100" data-level-row="${key}">
      <div class="flex items-center justify-between gap-3">
        <div class="font-extrabold text-lg">${label}</div>
        <label class="flex items-center gap-2 text-sm font-bold text-slate-600">
          <input type="checkbox" name="${key}.enabled" class="w-5 h-5 accent-emerald-600" ${cfg.enabled ? "checked" : ""}> פעיל
        </label>
      </div>
      <div class="grid grid-cols-2 gap-3 mt-3">
        <div>
          <label class="lbl"><span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-400 ml-1"></span>ראשונית — מתחת ל-</label>
          <div class="flex items-center gap-1"><input type="number" name="${key}.warn" min="1" max="100" class="inp-sm text-center font-bold" value="${cfg.warn}"><span class="font-bold text-slate-500">%</span></div>
        </div>
        <div>
          <label class="lbl"><span class="inline-block w-2.5 h-2.5 rounded-full bg-red-600 ml-1"></span>חמורה — מתחת ל-</label>
          <div class="flex items-center gap-1"><input type="number" name="${key}.crit" min="0" max="99" class="inp-sm text-center font-bold" value="${cfg.crit}"><span class="font-bold text-slate-500">%</span></div>
        </div>
      </div>
      <div class="mt-3 h-2 rounded-full overflow-hidden flex flex-row-reverse bg-emerald-300" data-bar="${key}" dir="ltr"></div>
      <div class="flex justify-between text-[10px] text-slate-400 mt-0.5" dir="ltr"><span>0%</span><span>100%</span></div>
    </div>`;
}

function mountAlertSettings(panel) {
  const prefs = getPrefs();

  panel.innerHTML = `
    <div class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-start">
      ${isDeveloper() ? `<div class="card">
        <h2 class="sec-title !mb-1">ההתראות שלי</h2>
        <div class="rounded-xl bg-slate-50 border border-slate-200 text-slate-800 p-4 mt-3">
          <div class="font-extrabold">חשבון מפתח</div>
          <p class="text-sm mt-1">לחשבון זה הרשאות מלאות, אבל הוא לא מקבל התראות. ההתראות נשלחות למנהל המערך (${esc(ADMIN_EMAILS.join(", "))}) לפי ההגדרות שלו.</p>
        </div>
        <div class="font-bold text-slate-700 mt-4 mb-2">בדיקת התראות (נשלחות רק אליך)</div>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="btn btn-ghost btn-sm" data-sample-local="critical">חמורה במסך</button>
          <button type="button" class="btn btn-ghost btn-sm" data-sample-local="warning">ראשונית במסך</button>
          <button type="button" class="btn btn-dark btn-sm" data-sample-push="critical">חמורה לטלפון</button>
          <button type="button" class="btn btn-dark btn-sm" data-sample-push="digest">סיכום בוקר לטלפון</button>
        </div>
        <p class="text-xs text-slate-500 mt-2">"לטלפון" רושם את המכשיר הזה ושולח דרך השרת. ההתראה מגיעה גם כשהאפליקציה סגורה, אחרי שמתקינים אותה ומאשרים התראות.</p>
      </div>` : ""}
      <form id="np-form" class="card" ${isDeveloper() ? "hidden" : ""}>
        <h2 class="sec-title !mb-1">ההתראות שלי</h2>
        <p class="text-sm text-slate-500 mb-2">מתי ואיך אתה מקבל התראה על הפעלה חדשה עם ליקויים.</p>
        <div class="divide-y divide-slate-100">
          ${switchInput("enabled", prefs.enabled, "לקבל התראות")}
          <div class="py-3" id="np-level">
            <div class="font-bold text-slate-800 mb-2">רמת התראה</div>
            <div class="grid grid-cols-2 gap-2">
              ${[["critical", "חמורות בלבד", "🚨"], ["warning", "ראשוניות וחמורות", "⚠️"]].map(([v, l, i]) => `
                <label class="crane-opt !p-3 cursor-pointer has-[:checked]:border-slate-900 has-[:checked]:bg-slate-50">
                  <input type="radio" name="minLevel" value="${v}" class="sr-only" ${prefs.minLevel === v ? "checked" : ""}>
                  <div class="text-xl">${i}</div><div class="font-bold text-sm">${l}</div>
                </label>`).join("")}
            </div>
          </div>
          ${switchInput("push", prefs.push, "התראות לטלפון, גם כשהאפליקציה סגורה", `<span id="np-perm">בודק תמיכה במכשיר…</span>`)}
          ${switchInput("sound", prefs.sound, "צליל התראה", "צפצוף אחד לראשונית, שלושה לחמורה")}
        </div>
        <p class="text-xs text-slate-500 bg-slate-50 rounded-lg p-2 mt-2">ההתראות לטלפון נרשמות לכל מכשיר בנפרד — יש להפעיל אותן בכל טלפון/מחשב שבו תרצה לקבל התראות. באייפון: קודם להוסיף את האתר למסך הבית.</p>
        <div class="flex gap-2 mt-4">
          <button class="btn btn-dark flex-1">שמור</button>
          <button type="button" id="np-test" class="btn btn-ghost">שלח בדיקה לטלפון</button>
        </div>
      </form>

      <form id="as-form" class="card">
        <h2 class="sec-title !mb-1">מדדי התראה</h2>
        <p class="text-sm text-slate-500 mb-1">חל על כל המערכת: קובע מה נחשב התראה ראשונית ומה התראה חמורה בבדיקת הפתיחה.</p>
        <div id="as-meta" class="text-xs text-slate-400 mb-2"></div>
        ${levelRow("fuel", "דלק", api.getAlertSettings().fuel)}
        ${levelRow("urea", "אוראה", api.getAlertSettings().urea)}
        <div class="pt-4">
          <div class="font-extrabold text-lg mb-1">ממצא "לא תקין"</div>
          <p class="text-xs text-slate-500 mb-2">איזו התראה נוצרת כשהמפעיל מסמן פריט כלא תקין</p>
          <div id="as-checks"></div>
        </div>
        <div class="pt-5 mt-4 border-t border-slate-200">
          <div class="font-extrabold text-lg mb-1">תוקף תסקיר ורישיון</div>
          <p class="text-xs text-slate-500 mb-2">נבדק בכל פתיחת הפעלה מול המערכת הקיימת: תסקיר (המוקדם מבין nextCheck ו-btNext) מרשומת הציוד, ורישיונות מרשומת המנופאי.</p>
          ${[["inspection", "תסקיר מנוף"], ["license", "רישיון מנופאי"]].map(([k, l]) => `
            <div class="py-3 border-b border-slate-100 last:border-0" data-valid="${k}">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <span class="font-bold">${l} — פג תוקף</span>
                <div class="seg" data-vsev="${k}">
                  ${SEV_OPTS.filter(([x]) => x !== "off").map(([x, t]) => `<button type="button" class="seg-btn" data-sev="${x}">${t}</button>`).join("")}
                </div>
              </div>
              ${k === "license" ? `<div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm">
                <span class="text-slate-500 font-bold">רישיונות לבדיקה:</span>
                ${Object.entries(api.LICENSE_FIELDS).map(([f, l]) => `<label class="flex items-center gap-1.5 font-bold"><input type="checkbox" name="lic.${f}" class="w-4 h-4 accent-emerald-600"> ${l}</label>`).join("")}
              </div>` : ""}
              <div class="flex flex-wrap items-center gap-x-5 gap-y-2 mt-2 text-sm">
                <label class="flex items-center gap-2 font-bold text-red-700"><input type="checkbox" name="${k}.block" class="w-5 h-5 accent-red-600"> חסום פתיחת הפעלה</label>
                <label class="flex items-center gap-2 font-bold text-slate-600">התראה ראשונית
                  <input type="number" name="${k}.soonDays" min="0" max="365" class="inp-sm !w-20 text-center"> ימים לפני</label>
              </div>
            </div>`).join("")}
        </div>
        <div class="pt-5 mt-4 border-t border-slate-200">
          <div class="font-extrabold text-lg mb-1">סוגי כלים במערכת</div>
          <p class="text-xs text-slate-500 mb-2">רק כלים מהסוגים המסומנים יופיעו בבחירה מתוך מערכת הציוד. ברירת המחדל: מנופים ומלגזות.</p>
          <div id="as-types" class="flex flex-wrap gap-x-4 gap-y-2 text-sm">${spinner}</div>
        </div>
        <div class="flex gap-2 mt-5">
          <button class="btn btn-primary flex-1">שמור מדדים</button>
          <button type="button" id="as-reset" class="btn btn-ghost">ברירת מחדל</button>
        </div>
      </form>
    </div>`;

  // ---- התראות לדוגמה (מפתח)
  $$("[data-sample-local]", panel).forEach((b) => {
    b.onclick = async () => {
      const level = b.dataset.sampleLocal;
      if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
      const title = `${level === "critical" ? "🚨 התראה חמורה" : "⚠️ התראה ראשונית"} — מנוף 7206179 (דוגמה)`;
      toast(title, level === "critical" ? "error" : "info");
      beep(level);
      systemNotify(title, "משה כהן · אילת\nדלק נמוך מאוד (8%) · ליקוי בשקלים", "sample");
    };
  });
  $$("[data-sample-push]", panel).forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try {
        const token = await push.enablePush();
        await api.addPushToken(state.user.uid, token);
        const n = await api.sendTestPush(b.dataset.samplePush);
        toast(n ? "נשלח. ההתראה אמורה להגיע תוך כמה שניות" : "לא נמצא מכשיר רשום", n ? "success" : "error");
      } catch (err) {
        toast(err?.code?.startsWith("functions/") ? "שירות ההתראות בשרת לא זמין, צריך להתקין שוב את הפונקציות" : /[א-ת]/.test(err?.message || "") ? err.message : errMsg(err), "error");
      } finally { b.disabled = false; }
    };
  });

  // ---- ההתראות שלי
  const np = $("#np-form", panel);
  const syncNp = () => {
    const on = np.elements.enabled.checked;
    $$("#np-level, [name=push], [name=sound]", np).forEach((el) => {
      (el.closest("label") || el).classList.toggle("opacity-40", !on);
    });
  };
  np.addEventListener("change", syncNp);
  syncNp();
  push.pushSupport().then((sup) => {
    $("#np-perm", np).textContent = !sup.ok ? sup.reason
      : Notification.permission === "granted" ? "✓ ההתראות מאושרות במכשיר זה" : "יתבקש אישור בשמירה";
  });
  np.onsubmit = async (e) => {
    e.preventDefault();
    const btn = np.querySelector("button:not([type])");
    const next = {
      enabled: np.elements.enabled.checked,
      minLevel: np.elements.minLevel.value,
      push: np.elements.push.checked,
      sound: np.elements.sound.checked,
    };
    btn.disabled = true;
    try {
      if (next.push) {
        const token = await push.enablePush();
        await api.addPushToken(state.user.uid, token);
        $("#np-perm", np).textContent = "✓ המכשיר הזה רשום לקבלת התראות";
      } else if (getPrefs().push) {
        const token = await push.currentToken();
        if (token) await api.removePushToken(state.user.uid, token);
        await push.disablePush();
      }
      await api.saveNotifyPrefs(state.user.uid, next);
      toast("העדפות ההתראות נשמרו", "success");
    } catch (err) {
      np.elements.push.checked = false;
      toast(err?.message?.startsWith("שגיאה") || /[א-ת]/.test(err?.message || "") ? err.message : errMsg(err), "error");
    } finally { btn.disabled = false; }
  };
  $("#np-test", panel).onclick = async (e) => {
    const b = e.currentTarget;
    if (!getPrefs().push) return toast("קודם הפעל 'התראות לטלפון' ולחץ שמור", "error");
    b.disabled = true;
    try {
      const n = await api.sendTestPush();
      toast(n ? `נשלחה התראת בדיקה ל-${n} מכשירים — אמורה להגיע תוך כמה שניות` : "לא נמצא מכשיר רשום — הפעל מחדש את ההתראות לטלפון", n ? "success" : "error");
    } catch (err) {
      toast(err?.code === "functions/not-found" || err?.code === "functions/internal" ? "שירות ההתראות בשרת עדיין לא הותקן (ראה הוראות התקנה)" : errMsg(err), "error");
    } finally { b.disabled = false; }
  };

  // ---- מדדי התראה
  const as = $("#as-form", panel);
  let checks = { ...api.getAlertSettings().checks };
  const vsev = { inspection: api.getAlertSettings().inspection.severity, license: api.getAlertSettings().license.severity };
  const drawVsev = () => $$("[data-vsev]", as).forEach((g) => {
    $$(".seg-btn", g).forEach((b) => b.setAttribute("aria-pressed", String(vsev[g.dataset.vsev] === b.dataset.sev)));
  });
  let dirty = false;

  const drawChecks = () => {
    $("#as-checks", as).innerHTML = Object.entries(api.CHECK_LABELS).map(([k, label]) => `
      <div class="flex flex-wrap items-center justify-between gap-2 py-2 border-b border-slate-100 last:border-0">
        <span class="font-bold">${esc(label.replace(" לא תקין", "").replace("ליקוי ב", ""))}</span>
        <div class="seg" data-check="${k}">
          ${SEV_OPTS.map(([v, l]) => `<button type="button" class="seg-btn" data-sev="${v}" aria-pressed="${checks[k] === v}">${l}</button>`).join("")}
        </div>
      </div>`).join("");
  };
  const drawBars = () => {
    ["fuel", "urea"].forEach((k) => {
      const en = as.elements[`${k}.enabled`].checked;
      const w = Number(as.elements[`${k}.warn`].value) || 0;
      const c = Number(as.elements[`${k}.crit`].value) || 0;
      const row = $(`[data-level-row="${k}"]`, as);
      $$("input[type=number]", row).forEach((i) => { i.disabled = !en; });
      const bar = $(`[data-bar="${k}"]`, as);
      bar.classList.toggle("opacity-30", !en);
      bar.innerHTML = `<div class="bg-red-400" style="width:${Math.min(c, 100)}%"></div><div class="bg-amber-300" style="width:${Math.max(0, Math.min(w, 100) - Math.min(c, 100))}%"></div>`;
      bar.style.flexDirection = "row";
    });
  };
  const fill = (cfg) => {
    ["fuel", "urea"].forEach((k) => {
      as.elements[`${k}.enabled`].checked = cfg[k].enabled;
      as.elements[`${k}.warn`].value = cfg[k].warn;
      as.elements[`${k}.crit`].value = cfg[k].crit;
    });
    checks = { ...cfg.checks };
    ["inspection", "license"].forEach((k) => {
      vsev[k] = cfg[k].severity;
      as.elements[`${k}.block`].checked = !!cfg[k].block;
      as.elements[`${k}.soonDays`].value = cfg[k].soonDays;
    });
    Object.keys(api.LICENSE_FIELDS).forEach((f) => { as.elements[`lic.${f}`].checked = cfg.license.fields.includes(f); });
    drawChecks();
    drawVsev();
    drawBars();
  };
  fill(api.getAlertSettings());

  // סוגי ציוד: נטענים מאוסף equipment (רק השדה type)
  let allTypes = null;
  const drawTypes = () => {
    const el = $("#as-types", as);
    if (!allTypes) return;
    const sel = api.getAlertSettings().equipmentTypes;
    el.innerHTML = allTypes.length ? allTypes.map((t) => `
      <label class="flex items-center gap-1.5 font-bold"><input type="checkbox" name="eqtype" value="${esc(t)}" class="w-4 h-4 accent-emerald-600"
        ${(sel ? sel.includes(t) : api.defaultRelevant(t)) ? "checked" : ""}> ${esc(api.fixTypeName(t))}</label>`).join("")
      : `<span class="text-slate-400">לא נמצאו סוגים ברשומות הציוד</span>`;
  };
  api.listEquipment().then((list) => {
    allTypes = [...new Set(list.map((e) => e.type).filter(Boolean))].sort((a, b) => a.localeCompare(b, "he"));
    drawTypes();
  }).catch(() => { $("#as-types", as).textContent = "לא ניתן לטעון את סוגי הציוד"; });

  as.addEventListener("input", () => { dirty = true; drawBars(); });
  as.addEventListener("click", (e) => {
    const b = e.target.closest(".seg-btn");
    if (!b) return;
    const vg = b.closest("[data-vsev]");
    if (vg) { vsev[vg.dataset.vsev] = b.dataset.sev; dirty = true; drawVsev(); return; }
    checks[b.closest("[data-check]").dataset.check] = b.dataset.sev;
    dirty = true;
    drawChecks();
  });
  $("#as-reset", panel).onclick = () => { fill(api.DEFAULT_ALERTS); dirty = true; toast("הוחזרו ערכי ברירת מחדל — לחץ 'שמור מדדים' כדי להחיל"); };

  const onAlerts = () => {
    if (!panel.isConnected) return;
    if (!dirty) { fill(api.getAlertSettings()); drawTypes(); }
  };
  document.addEventListener("alerts-changed", onAlerts);
  track(() => document.removeEventListener("alerts-changed", onAlerts));
  track(api.watchAlertSettings((_, raw) => {
    $("#as-meta", as).textContent = raw?.updatedBy ? `עודכן לאחרונה ע"י ${raw.updatedBy} · ${fmtDT(raw.updatedAt)}` : "משתמש בערכי ברירת המחדל";
  }, onErr));

  as.onsubmit = async (e) => {
    e.preventDefault();
    const data = { checks };
    for (const [k, l] of [["fuel", "דלק"], ["urea", "אוראה"]]) {
      const warn = Number(as.elements[`${k}.warn`].value);
      const crit = Number(as.elements[`${k}.crit`].value);
      const enabled = as.elements[`${k}.enabled`].checked;
      if (enabled) {
        if (!Number.isFinite(warn) || !Number.isFinite(crit) || warn < 1 || warn > 100 || crit < 0 || crit > 100) return toast(`${l}: ערכים חייבים להיות בין 0 ל-100`, "error");
        if (crit >= warn) return toast(`${l}: סף חמורה חייב להיות נמוך מסף ראשונית`, "error");
      }
      data[k] = { enabled, warn, crit };
    }
    for (const k of ["inspection", "license"]) {
      const soonDays = Number(as.elements[`${k}.soonDays`].value);
      if (!Number.isInteger(soonDays) || soonDays < 0 || soonDays > 365) return toast("ימי התראה מוקדמת: מספר שלם בין 0 ל-365", "error");
      data[k] = { severity: vsev[k], block: as.elements[`${k}.block`].checked, soonDays };
    }
    data.license.fields = Object.keys(api.LICENSE_FIELDS).filter((f) => as.elements[`lic.${f}`].checked);
    if (allTypes) data.equipmentTypes = $$("[name=eqtype]", as).filter((x) => x.checked).map((x) => x.value);
    try {
      await api.saveAlertSettings(data, state.profile.name);
      dirty = false;
      toast("מדדי ההתראה עודכנו לכל המערכת", "success");
    } catch (err) { onErr(err); }
  };
}
