// 到 Firebase 主控台 → 專案設定 → 一般 → 你的應用程式 → SDK 設定，把 firebaseConfig 貼過來。
// 這些值本來就會公開在前端，安全性由 firestore.rules 保護，可以放心 commit 到 GitHub。
export const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};
