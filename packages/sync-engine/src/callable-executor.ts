import type { QueueItem } from "./queue.types";

/**
 * Firebase callable function invoker interface.
 * Injected at runtime so the package stays free of Firebase SDK dependency.
 *
 * In the Operator App wire it as:
 *   import { getFunctions, httpsCallable } from 'firebase/functions';
 *   const fn = (name, data) => httpsCallable(getFunctions(), name)(data);
 */
export type CallableFn = (
  functionName: string,
  data: Record<string, unknown>
) => Promise<unknown>;

/**
 * Error categories that determine whether a failure should be retried.
 */
export type FailureCategory = "retryable" | "terminal" | "duplicate";

/**
 * Classifies a Firebase callable error so the retry engine knows
 * whether to retry or move to dead letter immediately.
 *
 * - retryable:  network, unavailable, deadline-exceeded, internal → retry with backoff
 * - terminal:   invalid-argument, not-found, permission-denied → dead letter immediately
 * - duplicate:  already-exists → silently succeed (server already processed)
 */
export function classifyError(error: unknown): FailureCategory {
  if (!isFirebaseError(error)) return "retryable";

  switch (error.code) {
    case "functions/already-exists":
      return "duplicate";

    case "functions/invalid-argument":
    case "functions/not-found":
    case "functions/permission-denied":
    case "functions/unauthenticated":
    case "functions/failed-precondition":
    case "functions/out-of-range":
    case "functions/unimplemented":
      return "terminal";

    // network / transient errors
    case "functions/unavailable":
    case "functions/deadline-exceeded":
    case "functions/internal":
    case "functions/resource-exhausted":
    default:
      return "retryable";
  }
}

/**
 * Creates the ExecuteFn expected by RetryEngine.
 *
 * Behaviour per error category:
 * - duplicate  → resolves silently (server already processed — idempotency guarantee)
 * - terminal   → throws with maxAttempts set to 0 so queue immediately dead-letters
 * - retryable  → throws so the queue schedules a backoff retry
 */
export function createCallableExecutor(callFn: CallableFn): (item: QueueItem) => Promise<void> {
  return async (item: QueueItem) => {
    try {
      await callFn(item.functionName, item.payload);
    } catch (error) {
      const category = classifyError(error);

      if (category === "duplicate") {
        // Server already processed this operationId — treat as success
        return;
      }

      if (category === "terminal") {
        // No point retrying — mutate maxAttempts so markFailed dead-letters immediately
        (item as { maxAttempts: number }).maxAttempts = item.attemptCount + 1;
      }

      throw error;
    }
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

interface FirebaseError {
  code: string;
  message: string;
}

function isFirebaseError(error: unknown): error is FirebaseError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as Record<string, unknown>)["code"] === "string"
  );
}
