import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { isSupported, getAnalytics } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-analytics.js";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithCredential,
  signInWithPopup,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported as isMessagingSupported,
  onMessage,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyCm_PqivPXxuUikwa2_8sE-KYh1VDNXfKI",
  authDomain: "oval-by-sentirax.firebaseapp.com",
  projectId: "oval-by-sentirax",
  storageBucket: "oval-by-sentirax.firebasestorage.app",
  messagingSenderId: "1081321199371",
  appId: "1:1081321199371:web:aae3b2e47a0c9409cdf40e",
  measurementId: "G-CVK43J74BT",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const googleProvider = new GoogleAuthProvider();
const messagingReady = isMessagingSupported()
  .then((supported) => (supported ? getMessaging(app) : null))
  .catch(() => null);

isSupported()
  .then((supported) => {
    if (supported) {
      getAnalytics(app);
    }
  })
  .catch(() => {});

export {
  Timestamp,
  GoogleAuthProvider,
  addDoc,
  app,
  auth,
  collection,
  createUserWithEmailAndPassword,
  db,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getDownloadURL,
  getMessaging,
  getToken,
  googleProvider,
  isMessagingSupported,
  messagingReady,
  onAuthStateChanged,
  onMessage,
  orderBy,
  query,
  ref,
  sendEmailVerification,
  sendPasswordResetEmail,
  runTransaction,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  signInWithCredential,
  signInWithPopup,
  signOut,
  storage,
  deleteToken,
  updateDoc,
  updateProfile,
  uploadBytes,
  where,
};
