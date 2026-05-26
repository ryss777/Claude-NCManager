import { describe, it, expect } from "vitest";
import { createProductTransferSchema, acceptProductTransferSchema } from "./transfer.schemas";

const validItem = {
  productId: "p1",
  productCatalogId: "cat-1",
  productName: "Shake X",
  quantity: 3,
  unitPrice: 25000,
  subtotal: 75000,
};

describe("transferItemSchema refine (via createProductTransferSchema)", () => {
  it("accepts an internal transfer with matching subtotal", () => {
    const result = createProductTransferSchema.safeParse({
      ownerId: "o1",
      destinationType: "club",
      destinationClubId: "c2",
      paymentType: "bayar",
      priceTier: "retail",
      items: [validItem],
      requestId: "11111111-1111-1111-1111-111111111111",
      operationId: "22222222-2222-2222-2222-222222222222",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a tampered subtotal", () => {
    const result = createProductTransferSchema.safeParse({
      ownerId: "o1",
      destinationType: "club",
      destinationClubId: "c2",
      paymentType: "bayar",
      priceTier: "retail",
      items: [{ ...validItem, subtotal: 1 }],
      requestId: "11111111-1111-1111-1111-111111111111",
      operationId: "22222222-2222-2222-2222-222222222222",
    });
    expect(result.success).toBe(false);
  });
});

describe("acceptProductTransferSchema", () => {
  it("requires destinationClubId", () => {
    const result = acceptProductTransferSchema.safeParse({
      ownerId: "o1",
      clubId: "c1",
      sourceOwnerId: "o-source",
      transferId: "t-1",
      requestId: "11111111-1111-1111-1111-111111111111",
      operationId: "22222222-2222-2222-2222-222222222222",
    });
    // destinationClubId is required for accept
    expect(result.success).toBe(false);
  });
});
