import { describe, it, expect } from "vitest";
import { createReplenishmentSchema, adjustInventoryStockSchema } from "./inventory.schemas";

const tenant = {
  ownerId: "o1",
  clubId: "c1",
  requestId: "11111111-1111-1111-1111-111111111111",
  operationId: "22222222-2222-2222-2222-222222222222",
};

const validReplItem = {
  productId: "p1",
  productName: "Shake X",
  quantity: 5,
  unitPrice: 20000,
  subtotal: 100000,
};

describe("replenishmentItemSchema refine (via createReplenishmentSchema)", () => {
  it("accepts items with matching subtotal", () => {
    const result = createReplenishmentSchema.safeParse({
      ...tenant,
      items: [validReplItem],
      priceTier: "retail",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a tampered subtotal", () => {
    const result = createReplenishmentSchema.safeParse({
      ...tenant,
      items: [{ ...validReplItem, subtotal: 1 }],
      priceTier: "retail",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty items array", () => {
    const result = createReplenishmentSchema.safeParse({
      ...tenant,
      items: [],
      priceTier: "retail",
    });
    expect(result.success).toBe(false);
  });
});

describe("adjustInventoryStockSchema", () => {
  it("accepts a non-negative quantity", () => {
    const result = adjustInventoryStockSchema.safeParse({
      ...tenant,
      inventoryItemId: "item-1",
      quantity: 0,
      unitCost: 0,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a negative target stock", () => {
    const result = adjustInventoryStockSchema.safeParse({
      ...tenant,
      inventoryItemId: "item-1",
      quantity: -1,
      unitCost: 0,
    });
    expect(result.success).toBe(false);
  });
});
