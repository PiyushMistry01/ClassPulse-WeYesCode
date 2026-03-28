// firebase.ts
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyB0lQ4kN9YBskuaNp-8AcOfTAfUYPbhSbU",
  authDomain: "classpulse-97289.firebaseapp.com",
  projectId: "classpulse-97289",
  storageBucket: "classpulse-97289.firebasestorage.app",
  messagingSenderId: "844668167541",
  appId: "1:844668167541:web:dfd90a7024876a30d05f3c"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);