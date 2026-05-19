"use client";

import { useEffect } from "react";
import { initFirebase, onAuthChanged } from "@/firebase/firebase";
import { useOwnerAuthStore } from "@/store/auth.store";

initFirebase();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setUser, clearUser, setLoading } = useOwnerAuthStore();

  useEffect(() => {
    const unsubscribe = onAuthChanged(async (user) => {
      if (!user) {
        clearUser();
        return;
      }

      // Read custom claims to get ownerId / clubId
      const token = await user.getIdTokenResult(true);
      const claims = token.claims as Record<string, unknown>;

      if (
        typeof claims["ownerId"] === "string" &&
        typeof claims["clubId"] === "string"
      ) {
        setUser({
          uid: user.uid,
          email: user.email ?? undefined,
          displayName: user.displayName ?? undefined,
          ownerId: claims["ownerId"],
          clubId: claims["clubId"],
          isAdmin: claims["isAdmin"] === true,
        });
      } else {
        // Google user but owner not yet initialized — clear until they run init
        setLoading(false);
        clearUser();
      }
    });

    return unsubscribe;
  }, [setUser, clearUser, setLoading]);

  return <>{children}</>;
}
