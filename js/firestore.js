// ===== שכבת הנתונים (Cloud Firestore) =====
import { db } from "./auth.js?v=202611082323";
import {
  collection, doc, getDoc, setDoc as fsSetDoc, updateDoc as fsUpdateDoc, deleteDoc as fsDeleteDoc, onSnapshot, query, where,
  orderBy, limit, getDocs, runTransaction as fsRunTransaction, serverTimestamp, Timestamp, arrayUnion, arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { DEFAULTS } from "./config.js?v=202611082323";

// אוספים של מערכת זו. users ו-meta שייכים למערכת הציוד הקיימת — לא נוגעים בהם.
// equipment / operators / sites נקראים בלבד.
export const COL = { users: "craneUsers", settings: "craneSettings", cranes: "cranes", operations: "operations" };

/** שגיאה עסקית עם הודעה בעברית שמוצגת למשתמש כמות שהיא */
export class AppError extends Error {}

// ---------- נעילת כתיבה (מצב "תצוגה כמשתמש") ----------
// כל כתיבה למסד עוברת דרך ארבע הפונקציות האלה. כשהנעילה פעילה — שום דבר לא נכתב.
let readOnly = false;
export const setReadOnly = (v) => { readOnly = !!v; };
export const isReadOnly = () => readOnly;
const blocked = () => Promise.reject(new AppError("מצב תצוגה: שום פעולה לא נשמרת"));
const setDoc = (...a) => (readOnly ? blocked() : fsSetDoc(...a));
const updateDoc = (...a) => (readOnly ? blocked() : fsUpdateDoc(...a));
const deleteDoc = (...a) => (readOnly ? blocked() : fsDeleteDoc(...a));
const runTransaction = (...a) => (readOnly ? blocked() : fsRunTransaction(...a));

const withId = (d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) });
const isNum = (n) => typeof n === "number" && !Number.isNaN(n);
const ms = (t) => (t?.toMillis ? t.toMillis() : 0);

// ---------- תאריכי תוקף ----------
const pad2 = (n) => String(n).padStart(2, "0");
export const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
/** ממיר תאריך (מחרוזת / Timestamp / Date) למחרוזת YYYY-MM-DD, או null */
export function normDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") v = v.toDate();
  if (v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = String(v).match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/); // DD/MM/YYYY
  return m2 ? `${m2[3]}-${pad2(m2[2])}-${pad2(m2[1])}` : null;
}
export const fmtDateStr = (s) => (s ? s.split("-").reverse().join("/") : "—");
export function daysUntil(dateStr, ref = todayStr()) {
  const a = normDate(dateStr);
  if (!a) return null;
  const toUtc = (x) => { const [y, m, d] = x.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((toUtc(a) - toUtc(ref)) / 864e5);
}
/** state: ok / soon / expired / unknown. התאריך עצמו נחשב עדיין בתוקף */
export function validity(dateStr, soonDays, ref) {
  const d = daysUntil(dateStr, ref);
  if (d == null) return { state: "unknown", days: null };
  if (d < 0) return { state: "expired", days: d };
  if (d <= soonDays) return { state: "soon", days: d };
  return { state: "ok", days: d };
}

// ---------- הגדרות התראות ----------
/** רמות: "off" — ללא התראה, "warning" — התראה ראשונית, "critical" — התראה חמורה */
export const CHECK_LABELS = {
  oilLevelOk: "גובה שמן לא תקין",
  waterLevelOk: "גובה מים לא תקין",
  strapsOk: "ליקוי ברצועות",
  shacklesOk: "ליקוי בשקלים",
  trolleyOk: "ליקוי בחתולים/תפסים",
};
export const DEFAULT_ALERTS = {
  fuel: { enabled: true, warn: DEFAULTS.fuelWarn, crit: DEFAULTS.fuelCrit },
  urea: { enabled: true, warn: DEFAULTS.ureaWarn, crit: DEFAULTS.ureaCrit },
  checks: { oilLevelOk: "critical", waterLevelOk: "critical", strapsOk: "warning", shacklesOk: "warning", trolleyOk: "warning" },
  // תוקף תסקיר המנוף (מאוסף equipment) ותוקף רישיון המנופאי
  inspection: { severity: "critical", block: true, soonDays: 30 },
  license: { severity: "critical", block: true, soonDays: 30, fields: ["craneLicenseExpiry"] },
};
/** שדות תוקף ברשומת מנופאי (אוסף operators) */
export const LICENSE_FIELDS = {
  craneLicenseExpiry: "רישיון מנוף נייד",
  militaryLicenseExpiry: "רישיון צבאי",
  civilianLicenseExpiry: "רישיון אזרחי",
  tatash: 'תת"ש',
};
let alertSettings = structuredClone(DEFAULT_ALERTS);
export const getAlertSettings = () => alertSettings;

function mergeAlerts(d = {}) {
  const m = structuredClone(DEFAULT_ALERTS);
  ["fuel", "urea", "inspection", "license"].forEach((k) => { if (d[k]) Object.assign(m[k], d[k]); });
  if (!Array.isArray(m.license.fields)) m.license.fields = [...DEFAULT_ALERTS.license.fields];
  m.license.fields = m.license.fields.filter((f) => f in LICENSE_FIELDS);
  m.equipmentTypes = Array.isArray(d.equipmentTypes) ? d.equipmentTypes.map(String) : null;
  if (d.checks) Object.keys(m.checks).forEach((k) => { if (["off", "warning", "critical"].includes(d.checks[k])) m.checks[k] = d.checks[k]; });
  return m;
}

export function watchAlertSettings(cb, onErr) {
  return onSnapshot(doc(db, COL.settings, "alerts"), (s) => {
    alertSettings = mergeAlerts(s.exists() ? s.data() : {});
    cb(alertSettings, s.exists() ? s.data() : null);
  }, onErr);
}

export function saveAlertSettings(data, updatedBy) {
  return setDoc(doc(db, COL.settings, "alerts"), { ...data, updatedBy, updatedAt: serverTimestamp() });
}

/** שולח התראת בדיקה לכל המכשירים הרשומים של המשתמש (Cloud Function) */
export async function sendTestPush(sample = "test") {
  if (readOnly) throw new AppError("מצב תצוגה: שום פעולה לא נשמרת");
  const { getFunctions, httpsCallable } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js");
  const { app } = await import("./auth.js?v=202611082323");
  const res = await httpsCallable(getFunctions(app, "me-west1"), "sendTestPush")({ sample });
  return res.data?.sent || 0;
}

export const addPushToken = (uid, token) => updateDoc(doc(db, COL.users, uid), { fcmTokens: arrayUnion(token) });
export const removePushToken = (uid, token) => updateDoc(doc(db, COL.users, uid), { fcmTokens: arrayRemove(token) });

export function saveNotifyPrefs(uid, prefs) {
  return updateDoc(doc(db, COL.users, uid), { notifyPrefs: prefs, updatedAt: serverTimestamp() });
}

// ---------- ניתוח בדיקת פתיחה ----------
/**
 * מסווג את ממצאי בדיקת הפתיחה לפי הגדרות ההתראות:
 * critical — התראה חמורה, warning — התראה ראשונית.
 * level מחזיר את הרמה הגבוהה שנמצאה (או null).
 */
export function analyzePreCheck(pc = {}, s = alertSettings) {
  const critical = [];
  const warning = [];
  const blockers = [];
  const ref = pc.checkDate || todayStr();
  const push = (sev, msg) => (sev === "critical" ? critical : warning).push(msg);
  const validityCheck = (cfg, dateStr, name, blockMsg) => {
    const v = validity(dateStr, cfg.soonDays, ref);
    if (v.state === "expired") {
      push(cfg.severity, `${name} פג תוקף (${fmtDateStr(normDate(dateStr))})`);
      if (cfg.block) blockers.push(blockMsg);
    } else if (v.state === "soon") {
      warning.push(v.days === 0 ? `${name} פג היום` : `${name} יפוג בעוד ${v.days} ימים`);
    } else if (v.state === "unknown") {
      warning.push(`אין תאריך ${name}`);
    }
  };
  if ("inspectionUntil" in pc) {
    if (!pc.equipmentId) warning.push("מנוף לא מקושר לרשומת תסקיר");
    else validityCheck(s.inspection, pc.inspectionUntil, "תסקיר מנוף", "תסקיר המנוף אינו בתוקף");
  }
  if ("licenses" in pc) {
    if (!pc.operatorRecordId) warning.push("המשתמש לא מקושר לרשומת מנופאי");
    else s.license.fields.forEach((f) => validityCheck(s.license, pc.licenses?.[f], LICENSE_FIELDS[f], `${LICENSE_FIELDS[f]} אינו בתוקף`));
  }
  const level = (name, label, v, cfg) => {
    if (!cfg.enabled || !isNum(v)) return;
    if (v < cfg.crit) critical.push(`${label} נמוך מאוד (${v}%)`);
    else if (v < cfg.warn) warning.push(`${label} נמוך (${v}%)`);
  };
  level("fuel", "דלק", pc.fuelLevel, s.fuel);
  level("urea", "אוראה", pc.ureaLevel, s.urea);
  Object.entries(CHECK_LABELS).forEach(([k, label]) => {
    if (pc[k] !== false) return;
    const sev = s.checks[k];
    if (sev === "critical") critical.push(label);
    else if (sev === "warning") warning.push(label);
  });
  return {
    critical,
    warning,
    hasCriticalIssue: critical.length > 0,
    hasWarning: warning.length > 0,
    blockers,
    level: critical.length ? "critical" : warning.length ? "warning" : null,
  };
}

// ---------- משתמשים ----------
export function watchUserProfile(uid, cb, onErr) {
  return onSnapshot(doc(db, COL.users, uid), (s) => cb(s.exists() ? withId(s) : null), onErr);
}

export function createAccessRequest(user, { name, phone, requestedRole, idNumber = "" }) {
  return setDoc(doc(db, COL.users, user.uid), {
    uid: user.uid,
    name,
    email: user.email || "",
    phone,
    requestedRole,
    idNumber,
    role: "pending",
    status: "pending",
    assignedSite: "",
    createdAt: serverTimestamp(),
  });
}

/** חשבון קבוע (מפתח / מנהל מערך): יוצר או מתקן את מסמך המשתמש כמנהל מערך מאושר */
export function ensureFixedAdmin(user, existing, { developer = false } = {}) {
  return setDoc(doc(db, COL.users, user.uid), {
    uid: user.uid,
    name: existing?.name || user.displayName || user.email,
    email: user.email,
    phone: existing?.phone || "",
    role: "admin",
    status: "approved",
    assignedSite: existing?.assignedSite || "",
    developer,
    ...(existing ? {} : { createdAt: serverTimestamp(), requestedRole: "admin" }),
  }, { merge: true });
}

export function watchUsers(cb, onErr) {
  return onSnapshot(collection(db, COL.users), (s) => {
    cb(s.docs.map(withId).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)));
  }, onErr);
}

/** שדות הקישור לרשומת מנופאי שנשמרים על המשתמש (עותק לתצוגה; המקור נבדק בפתיחת הפעלה) */
export const operatorLinkFields = (op) => (op
  ? { operatorRecordId: op.id, operatorRecordName: op.name, licenses: op.licenses }
  : { operatorRecordId: null, operatorRecordName: null, licenses: null });

export function approveUser(uid, { role, assignedSite, operator = null }, approvedBy) {
  return updateDoc(doc(db, COL.users, uid), {
    role, assignedSite, ...operatorLinkFields(operator), status: "approved", approvedBy, approvedAt: serverTimestamp(),
  });
}

export const rejectUser = (uid) => updateDoc(doc(db, COL.users, uid), { status: "rejected", updatedAt: serverTimestamp() });
export const updateUser = (uid, data) => updateDoc(doc(db, COL.users, uid), { ...data, updatedAt: serverTimestamp() });
export const deleteUser = (uid) => deleteDoc(doc(db, COL.users, uid));

// ---------- מנופים ----------
export function watchCranes(site, cb, onErr) {
  const ref = collection(db, "cranes");
  const q = site ? query(ref, where("site", "==", site)) : ref;
  return onSnapshot(q, (s) => {
    cb(s.docs.map(withId).sort((a, b) => String(a.craneId).localeCompare(String(b.craneId), "he", { numeric: true })));
  }, onErr);
}

export async function addCrane({ craneId, site, equipment = null }) {
  const id = String(craneId).trim();
  if (!id) throw new AppError("יש להזין מזהה מנוף");
  if (id.includes("/")) throw new AppError("מזהה מנוף לא יכול להכיל את התו /");
  const ref = doc(db, "cranes", id);
  await runTransaction(db, async (tx) => {
    const s = await tx.get(ref);
    if (s.exists()) throw new AppError(`מנוף ${id} כבר קיים במערכת`);
    tx.set(ref, {
      craneId: id, site: site.trim(), currentStatus: "available",
      activeOperationId: null, createdAt: serverTimestamp(),
      equipmentId: equipment?.id || null,
      equipmentLabel: equipment ? equipmentLabel(equipment) : null,
      equipmentType: equipment?.type || null,
      inspectionUntil: equipment?.nextInspectionDate || null,
    });
  });
}

export const updateCrane = (id, data) => updateDoc(doc(db, "cranes", id), { ...data, updatedAt: serverTimestamp() });
export const deleteCrane = (id) => deleteDoc(doc(db, "cranes", id));

// ---------- סוגי כלים: מנופים ומלגזות ----------
const RELEVANT_RE = /מנוף|מלגז|טלסקופ|crane|forklift|telehandler/i;
/** מתקן שגיאת כתיב נפוצה בסוגי הציוד ("מעמיק טלסקופי" → "מעמיס טלסקופי") — לתצוגה בלבד */
export const fixTypeName = (t) => String(t || "").replace(/מעמיק(\s*טלסקופ)/g, "מעמיס$1");
/** האם סוג הציוד רלוונטי למערכת (לפי בחירת המנהל, או כברירת מחדל — מנופים ומלגזות) */
export function isRelevantType(type, s = alertSettings) {
  const t = String(type || "").trim();
  return s.equipmentTypes ? s.equipmentTypes.includes(t) : RELEVANT_RE.test(t);
}
export const defaultRelevant = (type) => RELEVANT_RE.test(String(type || ""));
/** שם הסוג המלא כפי שרשום באתר התסקירים (למשל "מלגזה 5 טון"), או "מנוף" כשאין סוג */
export const kindOf = (type) => fixTypeName(type).trim() || "מנוף";
/** שם תצוגה לכלי: "מנוף 7206179" / "מלגזה 8812044" */
export const unitName = (x) => `${kindOf(x?.equipmentType ?? x?.craneKind)} ${x?.craneId ?? ""}`.trim();

// ---------- ציוד (אוסף equipment של אפליקציית התסקירים) ----------
const TZ_FIELDS = ["serialNumber"]; // הצ' של המנוף ברשומת הציוד
/** תוקף התסקיר = המוקדם מבין nextCheck ו-btNext */
export function equipmentInspectionDate(x = {}) {
  const dates = [x.nextCheck, x.btNext ?? x.btnext, x.nextInspectionDate].map(normDate).filter(Boolean).sort();
  return dates[0] || null;
}

/** מחזיר רשומת ציוד מצומצמת (בלי קבצי PDF) */
function slimEquipment(d) {
  const x = d.data();
  const tzField = TZ_FIELDS.find((f) => x[f]);
  return {
    id: d.id,
    tz: tzField ? String(x[tzField]) : d.id,
    type: String(x.type || x.equipmentType || "").trim(),
    siteId: x.siteId ?? null,
    manufacturer: x.manufacturer || "",
    model: x.model || (x.name && x.name !== (tzField ? x[tzField] : "") ? x.name : ""),
    nextInspectionDate: equipmentInspectionDate(x),
    lastInspectionDate: normDate(x.lastCheck ?? x.lastInspectionDate),
  };
}
export const equipmentLabel = (e) => [fixTypeName(e.type), `צ' ${e.tz}`, e.manufacturer, e.model].filter(Boolean).join(" · ");

export async function listEquipment() {
  const s = await getDocs(collection(db, "equipment"));
  return s.docs.map(slimEquipment).sort((a, b) => a.tz.localeCompare(b.tz, "he", { numeric: true }));
}
export async function getEquipment(id) {
  const s = await getDoc(doc(db, "equipment", id));
  return s.exists() ? slimEquipment(s) : null;
}

// ---------- מנופאים ואתרים (מערכת הציוד הקיימת) ----------
function slimOperator(d) {
  const x = d.data();
  const licenses = Object.fromEntries(Object.keys(LICENSE_FIELDS).map((f) => [f, normDate(x[f])]));
  return { id: d.id, name: x.name || d.id, idNumber: String(x.idNumber || ""), siteId: x.siteId ?? null, phone: x.phone || "", licenses };
}
export async function listOperators() {
  const s = await getDocs(collection(db, "operators"));
  return s.docs.map(slimOperator).sort((a, b) => a.name.localeCompare(b.name, "he"));
}
export async function listSites() {
  const s = await getDocs(collection(db, "sites"));
  // מזהה האתר במערכת הציוד יכול להיות שם המסמך או השדה id שבתוכו
  return s.docs.map((d) => ({ id: d.id, fieldId: d.data().id ?? null, name: String(d.data().name || d.data().title || d.data().siteName || d.id).trim() }));
}
/** שם האתר לפי מזהה (siteId) — לפי שם המסמך או השדה id שבתוכו */
export function siteNameFor(siteId, sites = []) {
  const sid = String(siteId ?? "").trim();
  if (!sid) return "";
  const s = sites.find((x) => String(x.id) === sid || String(x.fieldId ?? "") === sid
    || (!Number.isNaN(parseInt(sid)) && String(parseInt(x.fieldId)) === String(parseInt(sid))));
  return s ? s.name : "";
}

/**
 * מסנכרן כלים ממערכת הציוד: כל מנוף/מלגזה שעוד לא קיים — נוסף; קיים — מתעדכן (אתר, סוג, תסקיר).
 * מחזיר { added, updated, skipped }.
 */
export async function syncCranesFromEquipment(equipment, sites, cranes) {
  if (readOnly) return { added: 0, updated: 0, skipped: 0, retired: 0 };
  let added = 0, updated = 0, skipped = 0, retired = 0;
  const relevant = equipment.filter((e) => isRelevantType(e.type));
  const relevantIds = new Set(relevant.map((e) => e.id));
  for (const eq of relevant) {
    const site = siteNameFor(eq.siteId, sites);
    const fields = { equipmentId: eq.id, equipmentLabel: equipmentLabel(eq), equipmentType: eq.type || null, inspectionUntil: eq.nextInspectionDate || null };
    const linked = cranes.find((c) => c.equipmentId === eq.id);
    try {
      if (linked) {
        const patch = {};
        for (const [k, val] of Object.entries(fields)) if ((linked[k] ?? null) !== val) patch[k] = val;
        if (site && linked.site !== site && linked.currentStatus !== "in_use") patch.site = site;
        if (linked.retired) patch.retired = false;
        if (Object.keys(patch).length) { await updateDoc(doc(db, COL.cranes, linked.id), { ...patch, updatedAt: serverTimestamp() }); updated++; }
        continue;
      }
      const id = String(eq.tz || eq.id).trim().replace(/\//g, "-");
      const existing = cranes.find((c) => c.id === id);
      if (existing && existing.equipmentId) { skipped++; continue; } // אותו מספר כבר מקושר לרשומה אחרת
      await setDoc(doc(db, COL.cranes, id), {
        craneId: id, ...fields,
        retired: false,
        ...(existing ? {} : { site, currentStatus: "available", activeOperationId: null, createdAt: serverTimestamp(), autoImported: true }),
        updatedAt: serverTimestamp(),
      }, { merge: true });
      existing ? updated++ : added++;
    } catch (e) { console.warn("sync failed", eq.id, e); skipped++; }
  }
  // כלים שאינם (עוד) מנוף/מלגזה קיים באתר התסקירים — מסומנים כלא זמינים
  for (const c of cranes) {
    if (c.retired || (c.equipmentId && relevantIds.has(c.equipmentId)) || c.currentStatus === "in_use") continue;
    try { await updateDoc(doc(db, COL.cranes, c.id), { retired: true, updatedAt: serverTimestamp() }); retired++; } catch (e) { console.warn(e); }
  }
  return { added, updated, skipped, retired };
}

/** מרענן את עותק תאריכי הרישיון על המשתמשים מתוך רשומות המנופאים */
export async function syncUserLicenses(users, operators) {
  if (readOnly) return { added: 0, updated: 0, skipped: 0, retired: 0 };
  const byId = new Map(operators.map((o) => [o.id, o]));
  await Promise.all(users.filter((u) => u.operatorRecordId).map(async (u) => {
    const op = byId.get(u.operatorRecordId);
    if (op && JSON.stringify(op.licenses) !== JSON.stringify(u.licenses || null)) {
      try { await updateDoc(doc(db, COL.users, u.id), { licenses: op.licenses, operatorRecordName: op.name }); } catch (e) { console.warn(e); }
    }
  }));
}

export function linkCraneEquipment(craneId, eq) {
  return updateDoc(doc(db, "cranes", craneId), eq ? {
    equipmentId: eq.id, equipmentLabel: equipmentLabel(eq), equipmentType: eq.type || null, inspectionUntil: eq.nextInspectionDate || null,
    inspectionSyncedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  } : { equipmentId: null, equipmentLabel: null, equipmentType: null, inspectionUntil: null, updatedAt: serverTimestamp() });
}

/** מרענן את תאריך התסקיר השמור על המנופים מתוך אוסף equipment */
export async function syncCraneInspections(cranes) {
  if (readOnly) return { added: 0, updated: 0, skipped: 0, retired: 0 };
  const linked = cranes.filter((c) => c.equipmentId);
  await Promise.all(linked.map(async (c) => {
    try {
      const eq = await getEquipment(c.equipmentId);
      const next = eq?.nextInspectionDate || null;
      if (next !== (c.inspectionUntil || null)) {
        await updateDoc(doc(db, "cranes", c.id), { inspectionUntil: next, inspectionSyncedAt: serverTimestamp() });
      }
    } catch (e) { console.warn("inspection sync failed", c.id, e); }
  }));
}

// ---------- הפעלות ----------
export function watchMyActiveOperation(uid, cb, onErr) {
  const q = query(collection(db, "operations"), where("operatorId", "==", uid), where("status", "==", "active"));
  return onSnapshot(q, (s) => {
    const list = s.docs.map(withId).sort((a, b) => ms(b.startTime) - ms(a.startTime));
    cb(list[0] || null);
  }, onErr);
}

export function watchActiveOperations(cb, onErr) {
  const q = query(collection(db, "operations"), where("status", "==", "active"));
  return onSnapshot(q, (s) => cb(s.docs.map(withId).sort((a, b) => ms(b.startTime) - ms(a.startTime))), onErr);
}

export function watchOperationsSince(hours, cb, onErr) {
  const cutoff = Timestamp.fromDate(new Date(Date.now() - hours * 3600e3));
  const q = query(collection(db, "operations"), where("startTime", ">=", cutoff), orderBy("startTime", "desc"), limit(500));
  return onSnapshot(q, (s) => cb(s.docs.map(withId)), onErr);
}

export async function getOperationsRange(from, to, max = 1000) {
  const q = query(
    collection(db, "operations"),
    where("startTime", ">=", Timestamp.fromDate(from)),
    where("startTime", "<=", Timestamp.fromDate(to)),
    orderBy("startTime", "desc"),
    limit(max),
  );
  const s = await getDocs(q);
  return s.docs.map(withId);
}

/** פתיחת הפעלה: יוצר רשומת הפעלה ומסמן את המנוף "בהפעלה" — בטרנזקציה אחת */
export async function startOperation({ craneId, uid, operatorName, site, preCheck: input, operatorRecordId = null }) {
  const craneRef = doc(db, "cranes", craneId);
  const opRef = doc(collection(db, "operations"));
  await runTransaction(db, async (tx) => {
    const c = await tx.get(craneRef);
    if (!c.exists()) throw new AppError("המנוף לא נמצא במערכת");
    const crane = c.data();
    if (crane.currentStatus !== "available") throw new AppError(`מנוף ${craneId} כבר אינו פנוי — בחר מנוף אחר`);
    // תאריך התסקיר נקרא ישירות מרשומת הציוד — המקור המעודכן ביותר
    // הכלי חייב להיות קיים באתר התסקירים
    if (!crane.equipmentId || crane.retired) throw new AppError("הכלי לא קיים באתר התסקירים ולא ניתן להפעיל אותו");
    const e = await tx.get(doc(db, "equipment", crane.equipmentId));
    if (!e.exists() || !isRelevantType(e.data().type || e.data().equipmentType)) throw new AppError("הכלי הוסר מאתר התסקירים ולא ניתן להפעיל אותו");
    const inspectionUntil = equipmentInspectionDate(e.data());
    // תוקף הרישיונות נקרא ישירות מרשומת המנופאי
    let licenses = null;
    if (operatorRecordId) {
      const o = await tx.get(doc(db, "operators", operatorRecordId));
      licenses = o.exists() ? slimOperator(o).licenses : null;
    }
    const preCheck = {
      ...input,
      equipmentId: crane.equipmentId || null,
      equipmentLabel: crane.equipmentLabel || null,
      inspectionUntil,
      operatorRecordId,
      licenses,
      checkDate: todayStr(),
    };
    const a = analyzePreCheck(preCheck);
    if (a.blockers.length) throw new AppError(`לא ניתן לפתוח הפעלה: ${a.blockers.join(", ")}. פנה למנהל.`);
    tx.set(opRef, {
      id: opRef.id,
      craneId,
      craneKind: kindOf(crane.equipmentType),
      operatorId: uid,
      operatorName,
      site,
      status: "active",
      startTime: serverTimestamp(),
      endTime: null,
      preCheck: {
        ...preCheck,
        hasCriticalIssue: a.hasCriticalIssue,
        hasWarning: a.hasWarning,
        issues: [...a.critical, ...a.warning],
      },
      postCheck: null,
    });
    tx.update(craneRef, {
      currentStatus: "in_use", activeOperationId: opRef.id, updatedAt: serverTimestamp(),
      ...(crane.equipmentId ? { inspectionUntil, inspectionSyncedAt: serverTimestamp() } : {}),
    });
  });
  return opRef.id;
}

/** סגירת הפעלה: שומר בדיקת סגירה ומחזיר את המנוף לסטטוס פנוי — בטרנזקציה אחת */
export async function closeOperation(op, postCheck) {
  const opRef = doc(db, "operations", op.id);
  const craneRef = doc(db, "cranes", op.craneId);
  await runTransaction(db, async (tx) => {
    const o = await tx.get(opRef);
    const c = await tx.get(craneRef);
    if (!o.exists() || o.data().status !== "active") throw new AppError("ההפעלה כבר נסגרה");
    tx.update(opRef, { status: "completed", endTime: serverTimestamp(), postCheck });
    if (c.exists() && c.data().activeOperationId === op.id) {
      const keepMaintenance = c.data().currentStatus === "maintenance";
      tx.update(craneRef, {
        currentStatus: keepMaintenance ? "maintenance" : "available",
        activeOperationId: null,
        updatedAt: serverTimestamp(),
      });
    }
  });
}

/** סגירה כפויה ע"י מנהל (למשל מפעיל ששכח לסגור) */
export function forceCloseOperation(op, closedBy) {
  return closeOperation(op, {
    craneParked: false, bubaClosed: false, acOff: false, curtainClosed: false, craneLocked: false,
    notes: `נסגר בסגירה כפויה ע"י ${closedBy}`,
    forcedClose: true,
    closedBy,
  });
}
