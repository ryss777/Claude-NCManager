import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAuth, inMemoryPersistence, getAuth } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import type { CallableFn } from "@nc-manager/sync-engine";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
};

export function initFirebase(): void {
  if (getApps().length > 0) return;
  const app = initializeApp(firebaseConfig);
  // React Native: use in-memory auth state; session is restored from SecureStore on startup
  initializeAuth(app, { persistence: inMemoryPersistence });
}

export function firebaseAuth() {
  return getAuth(getApp());
}

/**
 * CallableFn wired to the Firebase JS SDK.
 * Injected into createCallableExecutor so sync-engine stays SDK-free.
 */
export const callableFn: CallableFn = (functionName, data) => {
  const fn = httpsCallable(getFunctions(getApp()), functionName);
  return fn(data).then((result) => result.data as unknown);
};
