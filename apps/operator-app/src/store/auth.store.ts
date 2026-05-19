import { create } from "zustand";

interface AuthState {
  isAuthenticated: boolean;
  operatorId: string | undefined;
  ownerId: string | undefined;
  clubId: string | undefined;
  customToken: string | undefined;
  deviceId: string | undefined;
  setAuth: (params: {
    operatorId: string;
    ownerId: string;
    clubId: string;
    customToken: string;
    deviceId: string;
  }) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  isAuthenticated: false,
  operatorId: undefined,
  ownerId: undefined,
  clubId: undefined,
  customToken: undefined,
  deviceId: undefined,
  setAuth: ({ operatorId, ownerId, clubId, customToken, deviceId }) =>
    set({ isAuthenticated: true, operatorId, ownerId, clubId, customToken, deviceId }),
  clearAuth: () =>
    set({
      isAuthenticated: false,
      operatorId: undefined,
      ownerId: undefined,
      clubId: undefined,
      customToken: undefined,
      deviceId: undefined,
    }),
}));
