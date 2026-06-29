// js/firebase.js 

// Import the functions you need from the SDKs you need
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyDx78sMfZyBcMubeuhv3-EIoy7Hk01ioGM",
  authDomain: "utm-communal-table.firebaseapp.com",
  projectId: "utm-communal-table",
  storageBucket: "utm-communal-table.firebasestorage.app",
  messagingSenderId: "892387636933",
  appId: "1:892387636933:web:d657b816e155e759c322ac",
  measurementId: "G-B28SNKQ2K4"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);