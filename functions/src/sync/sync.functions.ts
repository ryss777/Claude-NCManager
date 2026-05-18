import { onCall } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { requireAuth } from "../utils/validate";
import { syncReconcileSchema } from "@nc-manager/validation";
import type { ReconcileResult } from "@nc-manager/validation";

/**
 * Batch-checks which operationIds have already been processed by the server.
 *
 * Called by the client sync engine on startup or reconnect to reconcile the
 * local pending queue against the server idempotency log.
 *
 * Response per operationId:
 *   - already_processed: server has a record → client can safely drop from queue
 *   - not_found: no server record → client should retry
 */
export const sync_reconcile = onCall(async (request) => {
  requireAuth(request);

  const parsed = syncReconcileSchema.safeParse(request.data);
  if (!parsed.success) {
    const { HttpsError } = await import("firebase-functions/v2/https");
    throw new HttpsError("invalid-argument", parsed.error.errors[0]?.message ?? "Invalid input");
  }

  const { ownerId, clubId, operationIds } = parsed.data;
  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;

  // Batch-read all idempotency docs in a single Firestore round-trip
  const refs = operationIds.map((id) => db.doc(`${idempotencyPath}/${id}`));
  const snapshots = await db.getAll(...refs);

  const results: ReconcileResult[] = snapshots.map((snap, i) => {
    const operationId = operationIds[i] as string;
    if (snap.exists) {
      const data = snap.data() as Record<string, unknown>;
      return {
        operationId,
        status: "already_processed" as const,
        processedAt: typeof data["completedAt"] === "string" ? data["completedAt"] : undefined,
      };
    }
    return { operationId, status: "not_found" as const };
  });

  return { results };
});
