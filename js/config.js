// ===== הגדרות המערכת =====
// יש להחליף את הערכים באלה של פרויקט ה-Firebase שלך:
// Firebase Console → Project settings → General → Your apps → Web app → SDK setup and configuration
// פרויקט: cranes (cranes-a0759)
export const firebaseConfig = {
  apiKey: "AIzaSyDDDPT3cjlyTzhU0iFe-A7y2YlZW-iTdIk",
  authDomain: "cranes-a0759.firebaseapp.com",
  projectId: "cranes-a0759",
  storageBucket: "cranes-a0759.firebasestorage.app",
  messagingSenderId: "832258069678",
  appId: "1:832258069678:web:480d3c72f423725677c93f",
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
