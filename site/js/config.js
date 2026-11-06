// Public settings. The Firebase web config is NOT secret (it is meant to be in the browser);
// access is protected by the Firestore security rules.
export const firebaseConfig = {
  apiKey: "AIzaSyA3WX8dc3lS7UpUu6Dfp3-xf3eyANipv9U",
  authDomain: "chirpchat-8puu7.firebaseapp.com",
  projectId: "chirpchat-8puu7",
  storageBucket: "chirpchat-8puu7.firebasestorage.app",
  messagingSenderId: "94455463869",
  appId: "1:94455463869:web:717952e6eb0a22cb779cd4",
};

// Filled in automatically by the deploy workflow.
export const WORKER_URL = "__WORKER_URL__";

export const CATEGORIES = [
  "Tools", "Games", "Social", "Education", "Entertainment", "Productivity",
  "Photography", "Music", "Lifestyle", "Finance", "Communication", "Other",
];

export const LIMITS = {
  apkMB: 95,
  iconBytes: 1024 * 1024,
  shotBytes: 8 * 1024 * 1024,
  minShots: 2,
  maxShots: 8,
};

// Support. Leave SUPPORT_EMAIL empty to show only the GitHub issues link on the Support page.
export const SUPPORT_EMAIL = "";
export const SUPPORT_ISSUES_URL = "https://github.com/amtics285/ardroidhub/issues";
