import {
  SyncQueue,
  RetryEngine,
  MMKVStorageAdapter,
  recoverOnStartup,
  createCallableExecutor,
} from "@nc-manager/sync-engine";
import { MMKV } from "react-native-mmkv";
import { callableFn } from "@/firebase/firebase";

let queue: SyncQueue | undefined;
let engine: RetryEngine | undefined;

/**
 * Initializes the sync engine singleton.
 * Must be called once after the user authenticates (ownerId/clubId known).
 */
export function initSyncEngine(ownerId: string, clubId: string) {
  if (queue && engine) return { queue, engine };

  const mmkv = new MMKV({ id: `sync_${ownerId}_${clubId}` });
  const storage = new MMKVStorageAdapter(mmkv);
  queue = new SyncQueue(storage);
  engine = new RetryEngine(queue, createCallableExecutor(callableFn));

  const recovery = recoverOnStartup(queue, engine);
  if (__DEV__) {
    console.log("[SyncEngine] Recovered:", recovery);
  }

  engine.start();

  return { queue, engine };
}

/**
 * Returns the active sync engine instances.
 * Throws if initSyncEngine was never called.
 */
export function getSyncEngine(): { queue: SyncQueue; engine: RetryEngine } {
  if (!queue || !engine) {
    throw new Error("SyncEngine not initialized — call initSyncEngine first");
  }
  return { queue, engine };
}

export function stopSyncEngine() {
  engine?.stop();
}

export function startSyncEngine() {
  engine?.start();
}
