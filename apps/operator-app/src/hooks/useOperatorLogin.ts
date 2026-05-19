import { useState } from "react";
import { httpsCallable, getFunctions } from "firebase/functions";
import { signInWithCustomToken } from "firebase/auth";
import * as SecureStore from "expo-secure-store";
import { getApp } from "firebase/app";
import { firebaseAuth } from "@/firebase/firebase";
import { useAuthStore } from "@/store/auth.store";

const SECURE_STORE_KEY = "operator_session";

interface LoginParams {
  ownerId: string;
  clubId: string;
  operatorId: string;
  pin: string;
  deviceId: string;
}

interface LoginResult {
  success: boolean;
  error?: string | undefined;
}

export function useOperatorLogin() {
  const [loading, setLoading] = useState(false);
  const setAuth = useAuthStore((s) => s.setAuth);

  async function login(params: LoginParams): Promise<LoginResult> {
    setLoading(true);
    try {
      const fn = httpsCallable<LoginParams, { customToken: string }>(
        getFunctions(getApp()),
        "auth_operatorLogin"
      );
      const result = await fn(params);
      const { customToken } = result.data;

      await signInWithCustomToken(firebaseAuth(), customToken);

      // Persist session so it survives app restart
      await SecureStore.setItemAsync(
        SECURE_STORE_KEY,
        JSON.stringify({ ...params, customToken })
      );

      setAuth({
        operatorId: params.operatorId,
        ownerId: params.ownerId,
        clubId: params.clubId,
        customToken,
        deviceId: params.deviceId,
      });

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Login gagal";
      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }

  return { login, loading };
}

export async function restoreSession(): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(SECURE_STORE_KEY);
    if (!raw) return false;

    const session = JSON.parse(raw) as {
      operatorId: string;
      ownerId: string;
      clubId: string;
      customToken: string;
      deviceId: string;
    };

    await signInWithCustomToken(firebaseAuth(), session.customToken);

    useAuthStore.getState().setAuth({
      operatorId: session.operatorId,
      ownerId: session.ownerId,
      clubId: session.clubId,
      customToken: session.customToken,
      deviceId: session.deviceId,
    });

    return true;
  } catch {
    // Token expired or invalid — require fresh login
    await SecureStore.deleteItemAsync(SECURE_STORE_KEY);
    return false;
  }
}

export async function clearSession(): Promise<void> {
  await SecureStore.deleteItemAsync(SECURE_STORE_KEY);
  useAuthStore.getState().clearAuth();
}
