"use client";

import { create } from "zustand";

interface OwnerAuthState {
  uid: string | undefined;
  email: string | undefined;
  displayName: string | undefined;
  ownerId: string | undefined;
  clubId: string | undefined;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: {
    uid: string;
    email: string | undefined;
    displayName: string | undefined;
    ownerId: string;
    clubId: string;
  }) => void;
  clearUser: () => void;
  setLoading: (loading: boolean) => void;
}

export const useOwnerAuthStore = create<OwnerAuthState>((set) => ({
  uid: undefined,
  email: undefined,
  displayName: undefined,
  ownerId: undefined,
  clubId: undefined,
  isAuthenticated: false,
  isLoading: true,
  setUser: ({ uid, email, displayName, ownerId, clubId }) =>
    set({ uid, email, displayName, ownerId, clubId, isAuthenticated: true, isLoading: false }),
  clearUser: () =>
    set({
      uid: undefined,
      email: undefined,
      displayName: undefined,
      ownerId: undefined,
      clubId: undefined,
      isAuthenticated: false,
      isLoading: false,
    }),
  setLoading: (isLoading) => set({ isLoading }),
}));
