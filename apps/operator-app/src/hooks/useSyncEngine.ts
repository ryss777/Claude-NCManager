import { useEffect } from "react";
import { AppState } from "react-native";
import { useAuthStore } from "@/store/auth.store";
import {
  initSyncEngine,
  stopSyncEngine,
  startSyncEngine,
  getSyncEngine,
} from "@/sync/sync.setup";

/**
 * Initializes the sync engine when the user is authenticated and
 * handles app foreground/background lifecycle:
 *   - background → stop (avoids battery drain)
 *   - foreground → start + flush (catch up on missed retries)
 */
export function useSyncEngine() {
  const { isAuthenticated, ownerId, clubId } = useAuthStore();

  useEffect(() => {
    if (!isAuthenticated || !ownerId || !clubId) return;

    initSyncEngine(ownerId, clubId);

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        stopSyncEngine();
      } else if (nextState === "active") {
        startSyncEngine();
        // Flush immediately on foreground in case items became due while offline
        try {
          getSyncEngine().engine.flush();
        } catch {
          // Engine not yet ready — start() handles initial flush
        }
      }
    });

    return () => {
      subscription.remove();
      stopSyncEngine();
    };
  }, [isAuthenticated, ownerId, clubId]);
}
