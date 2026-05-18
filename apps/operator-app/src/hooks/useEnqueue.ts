import { useCallback } from "react";
import { getSyncEngine } from "@/sync/sync.setup";
import type { EnqueueParams } from "@nc-manager/sync-engine";

/**
 * Returns a stable enqueue function that dispatches operations to the
 * local sync queue. The queue handles retry, backoff, and dead-lettering.
 */
export function useEnqueue() {
  return useCallback((params: EnqueueParams) => {
    const { queue } = getSyncEngine();
    return queue.enqueue(params);
  }, []);
}
