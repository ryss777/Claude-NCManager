import { z } from "zod";
import { idempotencySchema, tenantRefSchema } from "./common.schemas";

const PRODUCT_CATEGORIES = ["Inner Nutrition", "Outer Nutrition", "Accessories"] as const;

const priceTiersSchema = z.object({
  retail: z.number().min(0),
  ds: z.number().min(0),
  sc: z.number().min(0),
  sbQp: z.number().min(0),
  spv: z.number().min(0),
});

export const createProductCatalogSchema = z.object({
  name: z.string().min(1).max(100),
  category: z.enum(PRODUCT_CATEGORIES),
  prices: priceTiersSchema,
});

export const updateProductCatalogSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  category: z.enum(PRODUCT_CATEGORIES).optional(),
  prices: priceTiersSchema.optional(),
});

export const addFromCatalogSchema = tenantRefSchema.extend({
  productCatalogId: z.string().min(1),
  unit: z.string().min(1).max(20),
  minimumStock: z.number().min(0),
});

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

export const adjustInventoryStockSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    inventoryItemId: z.string().min(1),
    quantity: z.number().min(0),
    unitCost: z.number().min(0),
    notes: z.string().max(500).optional(),
  });

export type CreateInventoryMovementInput = z.infer<
  typeof createInventoryMovementSchema
>;
