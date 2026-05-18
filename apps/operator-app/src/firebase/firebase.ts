import { initializeApp, getApps, getApp } from "firebase/app";
import { initializeAuth, inMemoryPersistence, getAuth, connectAuthEmulator } from "firebase/auth";
import { getFunctions, httpsCallable, connectFunctionsEmulator } from "firebase/functions";
import type { CallableFn } from "@nc-manager/sync-engine";

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "",
};

// Emulator host: localhost untuk iOS simulator, 10.0.2.2 untuk Android emulator,
// atau IP mesin untuk device fisik (set via EXPO_PUBLIC_EMULATOR_HOST)
const EMULATOR_HOST = process.env.EXPO_PUBLIC_EMULATOR_HOST ?? "localhost";

export function initFirebase(): void {
  if (getApps().length > 0) return;

  const app = initializeApp(firebaseConfig);
  const auth = initializeAuth(app, { persistence: inMemoryPersistence });
  const functions = getFunctions(app);

  // Sambungkan ke emulator lokal saat development
  if (__DEV__) {
    connectAuthEmulator(auth, `http://${EMULATOR_HOST}:9099`, { disableWarnings: true });
    connectFunctionsEmulator(functions, EMULATOR_HOST, 5001);
  }
}

export function firebaseAuth() {
  return getAuth(getApp());
}

export const callableFn: CallableFn = (functionName, data) => {
  const fn = httpsCallable(getFunctions(getApp()), functionName);
  return fn(data).then((result) => result.data as unknown);
};
