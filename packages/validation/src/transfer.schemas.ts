import { z } from "zod";
import { idempotencySchema, tenantRefSchema } from "./common.schemas";

const transferItemSchema = z.object({
  productId: z.string().min(1),
  productCatalogId: z.string().nullable().optional(),
  productName: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPrice: z.number().min(0),
  subtotal: z.number().min(0),
});

export const createProductTransferSchema = z.object({
  ownerId: z.string().min(1),
  sourceClubId: z.string().min(1),
}).merge(idempotencySchema).extend({
  destinationType: z.enum(["club", "owner"]),
  destinationOwnerId: z.string().min(1).optional(),
  destinationClubId: z.string().min(1).optional(),
  paymentType: z.enum(["bayar", "pinjam"]),
  priceTier: z.enum(["retail", "ds", "sc", "sbQp", "spv"]),
  items: z.array(transferItemSchema).min(1),
  notes: z.string().max(500).optional(),
});

export type CreateProductTransferInput = z.infer<typeof createProductTransferSchema>;

export const acceptProductTransferSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    sourceOwnerId: z.string().min(1),
    transferId: z.string().min(1),
    destinationClubId: z.string().min(1),
  });

export type AcceptProductTransferInput = z.infer<typeof acceptProductTransferSchema>;
