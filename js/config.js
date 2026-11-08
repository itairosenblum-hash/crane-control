// ===== הגדרות המערכת =====
// יש להחליף את הערכים באלה של פרויקט ה-Firebase שלך:
// Firebase Console → Project settings → General → Your apps → Web app → SDK setup and configuration
// פרויקט: crane (gen-lang-client-0743333908)
export const firebaseConfig = {
  apiKey: "AIzaSyCJWIyYuAHjSsy1a7EcfBSe_YXTs9x_xkc",
  authDomain: "gen-lang-client-0743333908.firebaseapp.com",
  projectId: "gen-lang-client-0743333908",
  storageBucket: "gen-lang-client-0743333908.firebasestorage.app",
  messagingSenderId: "784223603072",
  appId: "1:784223603072:web:88d9aa9c50f664aa4e5965",
};

// ערכי ברירת מחדל לספי התראה (באחוזים). מנהל המערך יכול לשנות אותם
// מתוך המערכת (לשונית "הגדרות התראות"); הערכים כאן משמשים רק עד שנשמרות הגדרות.
export const DEFAULTS = {
  fuelWarn: 30,  // מתחת לזה — התראה ראשונית
  fuelCrit: 15,  // מתחת לזה — התראה חמורה
  ureaWarn: 25,
  ureaCrit: 10,
};

// חלון היומן בלוח הבקרה של מנהל האתר (בשעות)
export const HISTORY_HOURS = 72;
