import { z } from "zod";
import { idempotencySchema, tenantRefSchema } from "./common.schemas";

const PRODUCT_CATEGORIES = ["Inner Nutrition", "Outer Nutrition", "Accessories"] as const;
const PRODUCT_UNITS = ["pcs", "kaleng", "botol"] as const;
const unitSchema = z.enum(PRODUCT_UNITS);

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
  name: z.string().min(1).max(100).nullish(),
  category: z.enum(PRODUCT_CATEGORIES).nullish(),
  prices: priceTiersSchema.nullish(),
});

export const addFromCatalogSchema = tenantRefSchema.extend({
  productCatalogId: z.string().min(1),
  unit: unitSchema,
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
    referenceId: z.string().nullish(),
    referenceType: z
      .enum(["transaction", "shift", "manual", "transfer"])
      .nullish(),
    notes: z.string().max(500).nullish(),
  });

export const createInventoryItemSchema = tenantRefSchema.extend({
  name: z.string().min(1).max(100),
  unit: unitSchema,
  category: z.string().max(50).nullish(),
  prices: priceTiersSchema,
  minimumStock: z.number().min(0).default(0),
});

export const removeInventoryItemSchema = tenantRefSchema.extend({
  inventoryItemId: z.string().min(1),
  force: z.boolean().default(false),
});

export const adjustInventoryStockSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    inventoryItemId: z.string().min(1),
    quantity: z.number().min(0),
    unitCost: z.number().min(0),
    notes: z.string().max(500).nullish(),
  });

const replenishmentItemSchema = z.object({
  productId: z.string().min(1),
  productName: z.string().min(1),
  quantity: z.number().int().min(1),
  unitPrice: z.number().min(0),
  subtotal: z.number().min(0),
});

export const createReplenishmentSchema = tenantRefSchema.merge(idempotencySchema).extend({
  items: z.array(replenishmentItemSchema).min(1),
  priceTier: z.enum(["retail", "ds", "sc", "sbQp", "spv"]),
  notes: z.string().max(500).nullish(),
});

export type CreateInventoryMovementInput = z.infer<
  typeof createInventoryMovementSchema
>;
