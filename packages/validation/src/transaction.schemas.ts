import { z } from "zod";
import { idempotencySchema, tenantRefSchema } from "./common.schemas";

const paymentMethodSchema = z.enum(["cash", "transfer", "member_balance"]);

const transactionItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  variantId: z.string().optional(),
  variantName: z.string().optional(),
  modifierIds: z.array(z.string()),
  modifierNames: z.array(z.string()),
  quantity: z.number().int().min(1).max(99),
  unitPrice: z.number().min(0),
  subtotal: z.number().min(0),
});

export const createTransactionSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    shiftId: z.string().min(1),
    items: z.array(transactionItemSchema).min(1).max(50),
    paymentMethod: paymentMethodSchema,
    amountPaid: z.number().min(0),
    customerId: z.string().optional(),
    membershipId: z.string().optional(),
    discount: z.number().min(0).default(0),
  })
  .refine(
    (data) => {
      const subtotal = data.items.reduce((sum, item) => sum + item.subtotal, 0);
      const total = subtotal - data.discount;
      return data.amountPaid >= total;
    },
    { message: "amountPaid must be >= total after discount" }
  );

export const reverseTransactionSchema = idempotencySchema.extend({
  transactionId: z.string().min(1),
  reason: z.string().min(10).max(500),
});

export const startMakingSchema = z.object({
  transactionId: z.string().min(1),
  operatorId: z.string().min(1),
});

export const completeTransactionSchema = z.object({
  transactionId: z.string().min(1),
  operatorId: z.string().min(1),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type ReverseTransactionInput = z.infer<typeof reverseTransactionSchema>;
