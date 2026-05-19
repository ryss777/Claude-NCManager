import { z } from "zod";
import { idempotencySchema, tenantRefSchema } from "./common.schemas";

const movementTypeSchema = z.enum([
  "sale",
  "restock",
  "adjustment",
  "waste",
  "transfer_in",
  "transfer_out",
  "opening_stock",
  "reversal",
]);

export const createInventoryMovementSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    inventoryItemId: z.string().min(1),
    movementType: movementTypeSchema,
    quantity: z.number().min(0.001),
    unitCost: z.number().min(0),
    referenceId: z.string().optional(),
    referenceType: z
      .enum(["transaction", "shift", "manual", "transfer"])
      .optional(),
    notes: z.string().max(500).optional(),
  });

export const createInventoryItemSchema = tenantRefSchema.extend({
  name: z.string().min(1).max(100),
  sku: z.string().max(50).optional(),
  unit: z.string().min(1).max(20),
  category: z.string().max(50).optional(),
  sellingPrice: z.number().min(0),
  costPerUnit: z.number().min(0).optional(),
  minimumStock: z.number().min(0),
});

export type CreateInventoryMovementInput = z.infer<
  typeof createInventoryMovementSchema
>;
