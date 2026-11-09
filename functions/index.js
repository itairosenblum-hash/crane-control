// ===== Cloud Functions — התראות Push לטלפון =====
// notifyOnOperation : הפעלה חדשה עם ליקוי → התראה מיידית למנהלים
// dailyExpiryDigest : כל בוקר 07:00 — תסקירים ורישיונות שפגו / עומדים לפוג
// sendTestPush      : כפתור "שלח בדיקה לטלפון" בהגדרות
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();
setGlobalOptions({ region: "me-west1", maxInstances: 5 });

const SITE_URL = "https://itairosenblum-hash.github.io/crane-control/";
const LICENSE_FIELDS = {
  craneLicenseExpiry: "רישיון מנוף נייד",
  militaryLicenseExpiry: "רישיון צבאי",
  civilianLicenseExpiry: "רישיון אזרחי",
  tatash: 'תת"ש',
};
const DEFAULTS = {
  inspection: { severity: "critical", soonDays: 30 },
  license: { severity: "critical", soonDays: 30, fields: ["craneLicenseExpiry"] },
};

// ---------- תאריכים ----------
const pad = (n) => String(n).padStart(2, "0");
function normDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") v = v.toDate();
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const m2 = String(v).match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  return m2 ? `${m2[3]}-${pad(m2[2])}-${pad(m2[1])}` : null;
}
const fmt = (s) => (s ? s.split("-").reverse().join("/") : "—");
function todayIL() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p; // YYYY-MM-DD
}
function daysUntil(dateStr, ref) {
  const a = normDate(dateStr);
  if (!a) return null;
  const u = (x) => { const [y, m, d] = x.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((u(a) - u(ref)) / 864e5);
}
const inspectionDate = (x = {}) => [x.nextCheck, x.btNext ?? x.btnext, x.nextInspectionDate].map(normDate).filter(Boolean).sort()[0] || null;

// ---------- נמענים ושליחה ----------
async function recipients({ level, site = null, adminsOnly = false }) {
  const snap = await db.collection("craneUsers").where("status", "==", "approved").get();
  return snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() })).filter((u) => {
    if (u.developer) return false; // חשבון המפתח לא מקבל התראות
    if (adminsOnly ? u.role !== "admin" : !["admin", "site_manager"].includes(u.role)) return false;
    if (u.role === "site_manager" && u.assignedSite && site && u.assignedSite !== site) return false;
    const p = { enabled: true, minLevel: "critical", push: false, ...(u.notifyPrefs || {}) };
    if (!p.enabled || !p.push) return false;
    if (level === "warning" && p.minLevel !== "warning") return false;
    return Array.isArray(u.fcmTokens) && u.fcmTokens.length > 0;
  });
}

const DEAD = new Set(["messaging/registration-token-not-registered", "messaging/invalid-registration-token", "messaging/invalid-argument"]);
async function sendTo(users, payload) {
  let sent = 0;
  for (const u of users) {
    const tokens = [...new Set(u.fcmTokens)];
    const res = await admin.messaging().sendEachForMulticast({
      tokens,
      data: Object.fromEntries(Object.entries({ link: SITE_URL, ...payload }).map(([k, v]) => [k, String(v ?? "")])),
      webpush: { headers: { Urgency: "high", TTL: "86400" } },
    });
    sent += res.successCount;
    const dead = res.responses.map((r, i) => (!r.success && DEAD.has(r.error?.code) ? tokens[i] : null)).filter(Boolean);
    if (dead.length) await u.ref.update({ fcmTokens: admin.firestore.FieldValue.arrayRemove(...dead) });
  }
  return sent;
}

// ---------- 1. הפעלה חדשה עם ליקויים ----------
// תצוגת כלי כמו באתר התסקירים: "עגורן צ-913007"
const kind = (t) => {
  const c = String(t || "").replace(/מעמיק(\s*טלסקופ)/g, "מעמיס$1").trim().replace(/\s+/g, " ");
  return c === "עגורן" || c.startsWith("עגורן ") ? "עגורן" : c || "מנוף";
};
const serial = (v) => {
  let r = String(v ?? "").trim().replace(/^צ\s*['"׳״`\-–]?\s*/, "").trim();
  if (!r) return "";
  if (/^\d[\d\s]*$/.test(r)) r = r.replace(/\s+/g, "");
  return "צ-" + r;
};

exports.notifyOnOperation = onDocumentCreated("operations/{opId}", async (event) => {
  const op = event.data?.data();
  if (!op) return;
  const pc = op.preCheck || {};
  const level = pc.hasCriticalIssue ? "critical" : pc.hasWarning ? "warning" : null;
  if (!level) return;
  const users = await recipients({ level, site: op.site });
  if (!users.length) return;
  const sent = await sendTo(users, {
    title: `${level === "critical" ? "🚨 התראה חמורה" : "⚠️ התראה ראשונית"} — ${kind(op.craneKind)} ${serial(op.craneId)}`,
    body: `${op.operatorName} · ${op.site}\n${(pc.issues || []).join(" · ")}`,
    tag: event.params.opId,
    level,
  });
  logger.info("operation alert", { opId: event.params.opId, level, users: users.length, sent });
});

// ---------- 2. סיכום יומי: תסקירים ורישיונות ----------
exports.dailyExpiryDigest = onSchedule({ schedule: "0 7 * * *", timeZone: "Asia/Jerusalem" }, async () => {
  const sDoc = await db.doc("craneSettings/alerts").get();
  const s = sDoc.exists ? sDoc.data() : {};
  const ins = { ...DEFAULTS.inspection, ...(s.inspection || {}) };
  const lic = { ...DEFAULTS.license, ...(s.license || {}) };
  const today = todayIL();
  const expired = [];
  const soon = [];

  // תסקירי מנופים (נקרא ישירות מאוסף equipment ומרענן את העותק על המנוף)
  const cranes = await db.collection("cranes").get();
  for (const c of cranes.docs) {
    const cr = c.data();
    if (!cr.equipmentId || cr.retired) continue; // כלי שאינו מנוף פעיל באתר התסקירים (למשל מלגזה) — לא נכלל
    const e = await db.doc(`equipment/${cr.equipmentId}`).get();
    const date = e.exists ? inspectionDate(e.data()) : null;
    if (date !== (cr.inspectionUntil || null)) await c.ref.update({ inspectionUntil: date, inspectionSyncedAt: admin.firestore.FieldValue.serverTimestamp() });
    const d = daysUntil(date, today);
    if (d == null) continue;
    const unit = `${kind(cr.equipmentType)} ${serial(cr.craneId)}`;
    if (d < 0) expired.push(`תסקיר ${unit} (${fmt(date)})`);
    else if (d <= ins.soonDays) soon.push(`תסקיר ${unit} — עוד ${d} ימים`);
  }

  // רישיונות מנופאים (רק משתמשים מאושרים שמקושרים לרשומת מנופאי)
  const users = await db.collection("craneUsers").where("status", "==", "approved").get();
  for (const u of users.docs) {
    const ud = u.data();
    if (!ud.operatorRecordId) continue;
    const o = await db.doc(`operators/${ud.operatorRecordId}`).get();
    if (!o.exists) continue;
    const od = o.data();
    const licenses = {};
    for (const f of lic.fields || []) {
      const date = normDate(od[f]);
      licenses[f] = date;
      const d = daysUntil(date, today);
      if (d == null) continue;
      if (d < 0) expired.push(`${LICENSE_FIELDS[f]} של ${od.name || ud.name} (${fmt(date)})`);
      else if (d <= lic.soonDays) soon.push(`${LICENSE_FIELDS[f]} של ${od.name || ud.name} — עוד ${d} ימים`);
    }
    await u.ref.update({ licenses: Object.fromEntries(Object.keys(LICENSE_FIELDS).map((f) => [f, normDate(od[f])])) });
  }

  if (!expired.length && !soon.length) return;
  const level = expired.length && (ins.severity === "critical" || lic.severity === "critical") ? "critical" : "warning";
  const to = await recipients({ level, adminsOnly: true });
  const lines = [
    ...(expired.length ? [`פג תוקף: ${expired.join(" · ")}`] : []),
    ...(soon.length ? [`יפוג בקרוב: ${soon.join(" · ")}`] : []),
  ];
  const sent = await sendTo(to, {
    title: `📄 תוקף תסקירים ורישיונות — ${expired.length} פגו, ${soon.length} בקרוב`,
    body: lines.join("\n").slice(0, 900),
    tag: `digest-${today}`,
    level,
  });
  logger.info("daily digest", { expired: expired.length, soon: soon.length, sent });
});

// ---------- 3. התראת בדיקה ----------
exports.sendTestPush = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "יש להתחבר");
  const ref = db.doc(`craneUsers/${req.auth.uid}`);
  const u = await ref.get();
  const tokens = u.exists ? u.data().fcmTokens || [] : [];
  if (!tokens.length) return { sent: 0 };
  const samples = {
    test: { title: "✅ בדיקת התראה — בקרת מנופים", body: "ההתראות לטלפון פועלות.", level: "warning" },
    critical: { title: "🚨 התראה חמורה — מנוף 7206179 (דוגמה)", body: "משה כהן · אילת\nדלק נמוך מאוד (8%) · ליקוי בשקלים", level: "critical" },
    warning: { title: "⚠️ התראה ראשונית — מנוף 8812044 (דוגמה)", body: "דן לוי · אשדוד\nתסקיר מנוף יפוג בעוד 12 ימים", level: "warning" },
    digest: { title: "📄 תוקף תסקירים ורישיונות — 1 פגו, 2 בקרוב (דוגמה)", body: "פג תוקף: תסקיר מנוף 7206179 (29/09/2026)\nיפוג בקרוב: רישיון מנוף נייד של משה כהן — עוד 20 ימים · תסקיר מנוף 8812044 — עוד 12 ימים", level: "critical" },
  };
  const s = samples[req.data?.sample] || samples.test;
  const sent = await sendTo([{ ref, fcmTokens: tokens }], { ...s, tag: `sample-${Date.now()}` });
  return { sent };
});
