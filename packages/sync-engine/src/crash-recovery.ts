import type { SyncQueue } from "./sync-queue";
import type { RetryEngine } from "./retry-engine";

export interface CrashRecoveryResult {
  recoveredCount: number;
  deadLetterCount: number;
  pendingCount: number;
}

/**
 * Must be called once at app start (before RetryEngine.start()).
 * Resets any in_flight items left over from a previous crash back to pending.
 */
export function recoverOnStartup(
  queue: SyncQueue,
  engine: RetryEngine
): CrashRecoveryResult {
  const recoveredCount = queue.recoverInFlight();
  const deadLetterCount = queue.getDeadLetters().length;
  const pendingCount = queue.getPendingCount();

  // Prune stale terminal items older than 7 days
  queue.prune();

  // Immediately flush any items that became pending after recovery
  if (recoveredCount > 0) {
    void engine.flush();
  }

  return { recoveredCount, deadLetterCount, pendingCount };
}
