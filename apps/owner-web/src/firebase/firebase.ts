import { initializeApp, getApps, getApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

export function initFirebase() {
  if (getApps().length > 0) return getApp();
  return initializeApp(firebaseConfig);
}

export function firebaseAuth() {
  return getAuth(getApp());
}

export function firebaseFunctions() {
  return getFunctions(getApp());
}

export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(firebaseAuth(), provider);
  return result.user;
}

export async function signOut(): Promise<void> {
  await firebaseSignOut(firebaseAuth());
}

export function onAuthChanged(callback: (user: User | null) => void) {
  return onAuthStateChanged(firebaseAuth(), callback);
}

export function callFunction<T = unknown>(name: string, data: Record<string, unknown>) {
  const fn = httpsCallable<Record<string, unknown>, T>(firebaseFunctions(), name);
  return fn(data).then((r) => r.data);
}
