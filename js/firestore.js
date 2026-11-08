// ===== שכבת הנתונים (Cloud Firestore) =====
import { db } from "./auth.js";
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, query, where,
  orderBy, limit, getDocs, runTransaction, serverTimestamp, Timestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { THRESHOLDS } from "./config.js";

/** שגיאה עסקית עם הודעה בעברית שמוצגת למשתמש כמות שהיא */
export class AppError extends Error {}

const withId = (d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) });
const isNum = (n) => typeof n === "number" && !Number.isNaN(n);
const ms = (t) => (t?.toMillis ? t.toMillis() : 0);

// ---------- ניתוח בדיקת פתיחה ----------
/**
 * מחזיר את רשימת הליקויים בבדיקת הפתיחה.
 * critical  — שמן/מים לא תקינים, דלק/אוראה מתחת לסף (קובע את hasCriticalIssue)
 * equipment — ליקוי בציוד הרמה: רצועות, שקלים, חתולים/תפסים
 */
export function analyzePreCheck(pc = {}) {
  const critical = [];
  const equipment = [];
  if (pc.oilLevelOk === false) critical.push("גובה שמן לא תקין");
  if (pc.waterLevelOk === false) critical.push("גובה מים לא תקין");
  if (isNum(pc.fuelLevel) && pc.fuelLevel < THRESHOLDS.fuelMin) critical.push(`דלק נמוך (${pc.fuelLevel}%)`);
  if (isNum(pc.ureaLevel) && pc.ureaLevel < THRESHOLDS.ureaMin) critical.push(`אוראה נמוכה (${pc.ureaLevel}%)`);
  if (pc.strapsOk === false) equipment.push("ליקוי ברצועות");
  if (pc.shacklesOk === false) equipment.push("ליקוי בשקלים");
  if (pc.trolleyOk === false) equipment.push("ליקוי בחתולים/תפסים");
  return {
    critical,
    equipment,
    hasCriticalIssue: critical.length > 0,
    hasEquipmentIssue: equipment.length > 0,
  };
}

// ---------- משתמשים ----------
export function watchUserProfile(uid, cb, onErr) {
  return onSnapshot(doc(db, "users", uid), (s) => cb(s.exists() ? withId(s) : null), onErr);
}

export function createAccessRequest(user, { name, phone, requestedRole }) {
  return setDoc(doc(db, "users", user.uid), {
    uid: user.uid,
    name,
    email: user.email || "",
    phone,
    requestedRole,
    role: "pending",
    status: "pending",
    assignedSite: "",
    createdAt: serverTimestamp(),
  });
}

export function watchUsers(cb, onErr) {
  return onSnapshot(collection(db, "users"), (s) => {
    cb(s.docs.map(withId).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)));
  }, onErr);
}

export function approveUser(uid, { role, assignedSite }, approvedBy) {
  return updateDoc(doc(db, "users", uid), {
    role, assignedSite, status: "approved", approvedBy, approvedAt: serverTimestamp(),
  });
}

export const rejectUser = (uid) => updateDoc(doc(db, "users", uid), { status: "rejected", updatedAt: serverTimestamp() });
export const updateUser = (uid, data) => updateDoc(doc(db, "users", uid), { ...data, updatedAt: serverTimestamp() });
export const deleteUser = (uid) => deleteDoc(doc(db, "users", uid));

// ---------- מנופים ----------
export function watchCranes(site, cb, onErr) {
  const ref = collection(db, "cranes");
  const q = site ? query(ref, where("site", "==", site)) : ref;
  return onSnapshot(q, (s) => {
    cb(s.docs.map(withId).sort((a, b) => String(a.craneId).localeCompare(String(b.craneId), "he", { numeric: true })));
  }, onErr);
}

export async function addCrane({ craneId, site }) {
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
    });
  });
}

export const updateCrane = (id, data) => updateDoc(doc(db, "cranes", id), { ...data, updatedAt: serverTimestamp() });
export const deleteCrane = (id) => deleteDoc(doc(db, "cranes", id));

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
export async function startOperation({ craneId, uid, operatorName, site, preCheck }) {
  const craneRef = doc(db, "cranes", craneId);
  const opRef = doc(collection(db, "operations"));
  const a = analyzePreCheck(preCheck);
  await runTransaction(db, async (tx) => {
    const c = await tx.get(craneRef);
    if (!c.exists()) throw new AppError("המנוף לא נמצא במערכת");
    if (c.data().currentStatus !== "available") throw new AppError(`מנוף ${craneId} כבר אינו פנוי — בחר מנוף אחר`);
    tx.set(opRef, {
      id: opRef.id,
      craneId,
      operatorId: uid,
      operatorName,
      site,
      status: "active",
      startTime: serverTimestamp(),
      endTime: null,
      preCheck: {
        ...preCheck,
        hasCriticalIssue: a.hasCriticalIssue,
        hasEquipmentIssue: a.hasEquipmentIssue,
        issues: [...a.critical, ...a.equipment],
      },
      postCheck: null,
    });
    tx.update(craneRef, { currentStatus: "in_use", activeOperationId: opRef.id, updatedAt: serverTimestamp() });
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
