"use client";

import { create } from "zustand";

interface OwnerAuthState {
  uid: string | undefined;
  email: string | undefined;
  displayName: string | undefined;
  ownerId: string | undefined;
  clubId: string | undefined;
  isAdmin: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: {
    uid: string;
    email: string | undefined;
    displayName: string | undefined;
    ownerId: string;
    clubId: string;
    isAdmin: boolean;
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
  isAdmin: false,
  isAuthenticated: false,
  isLoading: true,
  setUser: ({ uid, email, displayName, ownerId, clubId, isAdmin }) =>
    set({ uid, email, displayName, ownerId, clubId, isAdmin, isAuthenticated: true, isLoading: false }),
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
