// ===== אתחול Firebase ואימות משתמשים =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  signOut, onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js?v=202611090711";

// שם אפליקציה נפרד: מערכת הציוד הקיימת (/crane/) רצה על אותו דומיין ואותו פרויקט —
// כך ההתחברות של שתי המערכות נשמרת בנפרד ולא דורסת זו את זו.
export const app = initializeApp(firebaseConfig, "crane-control");
export const auth = getAuth(app);

// מטמון מקומי — מאפשר טעינה מהירה ותצוגה גם בקליטה חלשה בשטח
let firestore;
try {
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  console.warn("Persistent cache unavailable, falling back to memory cache", e);
  firestore = initializeFirestore(app, {});
}
export const db = firestore;

export async function login() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  try {
    return await signInWithPopup(auth, provider);
  } catch (e) {
    // דפדפנים בנייד שחוסמים חלונות קופצים — מעבר להתחברות בהפניה
    if (e?.code === "auth/popup-blocked" || e?.code === "auth/operation-not-supported-in-this-environment") {
      return signInWithRedirect(auth, provider);
    }
    throw e;
  }
}

export const logout = () => signOut(auth);
export const onAuth = (cb) => onAuthStateChanged(auth, cb);
