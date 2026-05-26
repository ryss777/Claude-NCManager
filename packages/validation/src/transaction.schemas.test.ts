import { describe, it, expect } from "vitest";
import {
  createTransactionSchema,
  ownerSaleSchema,
  exchangeItemsSchema,
  reverseTransactionSchema,
} from "./transaction.schemas";

const validItem = {
  productId: "p1",
  productName: "Shake X",
  variantId: null,
  variantName: null,
  modifierIds: [] as string[],
  modifierNames: [] as string[],
  quantity: 2,
  unitPrice: 50000,
  subtotal: 100000,
};

const tenantFields = {
  ownerId: "o1",
  clubId: "c1",
  requestId: "11111111-1111-1111-1111-111111111111",
  operationId: "22222222-2222-2222-2222-222222222222",
};

describe("transactionItemSchema refine (via createTransactionSchema)", () => {
  it("accepts an item where subtotal == unitPrice * quantity", () => {
    const result = createTransactionSchema.safeParse({
      ...tenantFields,
      shiftId: "s1",
      items: [validItem],
      paymentMethod: "cash",
      amountPaid: 100000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a tampered subtotal below the true price", () => {
    const result = createTransactionSchema.safeParse({
      ...tenantFields,
      shiftId: "s1",
      items: [{ ...validItem, subtotal: 1 }],
      paymentMethod: "cash",
      amountPaid: 1,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".").endsWith("subtotal"))).toBe(true);
    }
  });

  it("rejects subtotal above the true price too", () => {
    const result = createTransactionSchema.safeParse({
      ...tenantFields,
      shiftId: "s1",
      items: [{ ...validItem, subtotal: 999999 }],
      paymentMethod: "cash",
      amountPaid: 999999,
    });
    expect(result.success).toBe(false);
  });
});

describe("ownerSaleSchema", () => {
  it("requires customerId when amountPaid is less than total", () => {
    const result = ownerSaleSchema.safeParse({
      ...tenantFields,
      items: [validItem],
      paymentMethod: "cash",
      amountPaid: 50000,        // partial
      discount: 0,
      // customerId omitted on purpose
    });
    expect(result.success).toBe(false);
  });

  it("allows partial payment when customerId is provided (debt path)", () => {
    const result = ownerSaleSchema.safeParse({
      ...tenantFields,
      items: [validItem],
      paymentMethod: "cash",
      amountPaid: 50000,
      customerId: "cust-1",
      discount: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts a walk-in cash sale when fully paid", () => {
    const result = ownerSaleSchema.safeParse({
      ...tenantFields,
      items: [validItem],
      paymentMethod: "cash",
      amountPaid: 100000,
      discount: 0,
    });
    expect(result.success).toBe(true);
  });
});

describe("exchangeItemSchema refine (via exchangeItemsSchema)", () => {
  const validExchangeItem = {
    productId: "p1",
    productName: "Shake X",
    quantity: 1,
    unitPrice: 50000,
    subtotal: 50000,
  };

  it("accepts return items with matching subtotal", () => {
    const result = exchangeItemsSchema.safeParse({
      ...tenantFields,
      transactionId: "tx-1",
      returnItems: [validExchangeItem],
      newItems: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects a tampered return subtotal", () => {
    const result = exchangeItemsSchema.safeParse({
      ...tenantFields,
      transactionId: "tx-1",
      returnItems: [{ ...validExchangeItem, subtotal: 1 }],
      newItems: null,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a tampered new-item subtotal", () => {
    const result = exchangeItemsSchema.safeParse({
      ...tenantFields,
      transactionId: "tx-1",
      returnItems: [validExchangeItem],
      newItems: [{ ...validExchangeItem, subtotal: 1 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("reverseTransactionSchema", () => {
  it("requires a reason of at least 10 chars", () => {
    const result = reverseTransactionSchema.safeParse({
      ...tenantFields,
      transactionId: "tx-1",
      reason: "short",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a reason that meets the minimum length", () => {
    const result = reverseTransactionSchema.safeParse({
      ...tenantFields,
      transactionId: "tx-1",
      reason: "Customer requested cancellation due to mistake",
    });
    expect(result.success).toBe(true);
  });
});
