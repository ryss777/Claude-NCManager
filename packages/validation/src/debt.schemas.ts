import { z } from "zod";
import { idempotencySchema, tenantRefSchema } from "./common.schemas";

export const recordDebtPaymentSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    debtId: z.string().min(1),
    amount: z.number().min(1),
    paymentMethod: z.enum(["cash", "transfer"]),
    notes: z.string().max(500).nullish(),
  });

export type RecordDebtPaymentInput = z.infer<typeof recordDebtPaymentSchema>;
