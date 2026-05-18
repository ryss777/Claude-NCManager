import { z } from "zod";
import { tenantRefSchema } from "./common.schemas";

export const syncReconcileSchema = tenantRefSchema.extend({
  operationIds: z
    .array(z.string().uuid("Each operationId must be a valid UUID"))
    .min(1, "At least one operationId is required")
    .max(100, "Maximum 100 operationIds per reconcile request"),
});

export type SyncReconcileInput = z.infer<typeof syncReconcileSchema>;

export type ReconcileStatus = "already_processed" | "not_found";

export interface ReconcileResult {
  operationId: string;
  status: ReconcileStatus;
  processedAt?: string | undefined;
}
