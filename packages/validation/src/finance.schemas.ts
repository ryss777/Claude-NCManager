import { z } from "zod";
import { idempotencySchema, tenantRefSchema } from "./common.schemas";

export const openShiftSchema = tenantRefSchema.merge(idempotencySchema).extend({
  operatorId: z.string().min(1),
  deviceId: z.string().min(1),
  openingCash: z.number().min(0),
});

export const closeShiftSchema = tenantRefSchema.merge(idempotencySchema).extend({
  shiftId: z.string().min(1),
  operatorId: z.string().min(1),
  actualCash: z.number().min(0),
  notes: z.string().max(500).optional(),
});

export const createJournalEntrySchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    entryType: z.enum([
      "sale",
      "reversal",
      "expense",
      "shift_close",
      "adjustment",
      "membership_payment",
      "cash_in",
      "cash_out",
    ]),
    amount: z.number().positive(),
    debitAccount: z.string().min(4).max(4),
    creditAccount: z.string().min(4).max(4),
    description: z.string().min(1).max(500),
    referenceId: z.string().optional(),
    shiftId: z.string().optional(),
  });

export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
