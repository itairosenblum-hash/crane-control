// ===== התראות Push לטלפון (Firebase Cloud Messaging) =====
import { app } from "./auth.js?v=202611092045";
import { getMessaging, getToken, deleteToken, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { VAPID_KEY } from "./config.js?v=202611092045";

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.("(display-mode: standalone)").matches || navigator.standalone === true;

/** האם המכשיר יכול לקבל Push, ואם לא — למה */
export async function pushSupport() {
  if (!VAPID_KEY) return { ok: false, reason: "המפתח לא הוגדר עדיין במערכת" };
  if (isIOS() && !isStandalone()) return { ok: false, reason: "באייפון: יש להוסיף את האתר למסך הבית (שיתוף ← הוסף למסך הבית) ולפתוח משם" };
  if (!("serviceWorker" in navigator) || !("Notification" in window)) return { ok: false, reason: "הדפדפן לא תומך בהתראות" };
  if (!(await isSupported().catch(() => false))) return { ok: false, reason: "הדפדפן לא תומך בהתראות Push" };
  if (Notification.permission === "denied") return { ok: false, reason: "ההתראות נחסמו — יש לאשר אותן בהגדרות הדפדפן לאתר זה" };
  return { ok: true };
}

async function registration() {
  return (await navigator.serviceWorker.getRegistration()) || navigator.serviceWorker.register("sw.js");
}

/** מבקש הרשאה ומחזיר את מזהה המכשיר (token) */
export async function enablePush() {
  const sup = await pushSupport();
  if (!sup.ok) throw new Error(sup.reason);
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("לא אושרה הרשאת התראות");
  return getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: await registration() });
}

/** מחזיר את המזהה הנוכחי בלי לבקש הרשאה (לרענון שקט) */
export async function currentToken() {
  if (!VAPID_KEY || Notification.permission !== "granted" || !(await isSupported().catch(() => false))) return null;
  try { return await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: await registration() }); } catch { return null; }
}

export async function disablePush() {
  try { await deleteToken(getMessaging(app)); } catch { /* ignore */ }
}
