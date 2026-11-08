// ===== הגדרות המערכת =====
// יש להחליף את הערכים באלה של פרויקט ה-Firebase שלך:
// Firebase Console → Project settings → General → Your apps → Web app → SDK setup and configuration
// פרויקט: crane (gen-lang-client-0743333908)
// חסרים רק apiKey ו-appId — מופיעים אחרי רישום Web App בפרויקט.
export const firebaseConfig = {
  apiKey: "PASTE_API_KEY_HERE",
  authDomain: "gen-lang-client-0743333908.firebaseapp.com",
  projectId: "gen-lang-client-0743333908",
  storageBucket: "gen-lang-client-0743333908.firebasestorage.app",
  messagingSenderId: "784223603072",
  appId: "PASTE_APP_ID_HERE",
};

// ספי התרעה (באחוזים) — מתחת לערכים אלה הבדיקה מסומנת כליקוי קריטי
export const THRESHOLDS = {
  fuelMin: 25,
  ureaMin: 20,
};

// חלון היומן בלוח הבקרה של מנהל האתר (בשעות)
export const HISTORY_HOURS = 72;
