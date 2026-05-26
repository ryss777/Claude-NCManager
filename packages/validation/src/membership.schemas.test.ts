import { describe, it, expect } from "vitest";
import {
  activateMembershipSchema,
  createMembershipPlanSchema,
  createLockerPlanSchema,
  lockerRecordVisitSchema,
} from "./membership.schemas";

const tenant = {
  ownerId: "o1",
  clubId: "c1",
  requestId: "11111111-1111-1111-1111-111111111111",
  operationId: "22222222-2222-2222-2222-222222222222",
};

describe("activateMembershipSchema", () => {
  const base = {
    ...tenant,
    customerId: "cust-1",
    planId: "plan-1",
    transactionId: "tx-1",
  };

  it("accepts a minimal regular activation", () => {
    const result = activateMembershipSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("accepts a locker activation with sessions", () => {
    const result = activateMembershipSchema.safeParse({
      ...base,
      lockerSessions: 10,
      amountPaid: 500000,
      paymentMethod: "cash",
    });
    expect(result.success).toBe(true);
  });

  it("rejects lockerSessions < 1", () => {
    const result = activateMembershipSchema.safeParse({ ...base, lockerSessions: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer lockerSessions", () => {
    const result = activateMembershipSchema.safeParse({ ...base, lockerSessions: 3.5 });
    expect(result.success).toBe(false);
  });

  it("rejects unknown paymentMethod", () => {
    const result = activateMembershipSchema.safeParse({
      ...base, paymentMethod: "qris",
    });
    expect(result.success).toBe(false);
  });
});

describe("createMembershipPlanSchema (regular)", () => {
  it("requires durationDays when hasExpiry is true", () => {
    const result = createMembershipPlanSchema.safeParse({
      ownerId: "o1", clubId: "c1",
      name: "Gold", tier: "gold", price: 500000, visitQuota: 10,
      hasExpiry: true, benefits: [],
    });
    expect(result.success).toBe(false);
  });

  it("allows no-expiry plans without durationDays", () => {
    const result = createMembershipPlanSchema.safeParse({
      ownerId: "o1", clubId: "c1",
      name: "Lifetime", tier: "platinum", price: 5000000, visitQuota: 999,
      hasExpiry: false, benefits: [],
    });
    expect(result.success).toBe(true);
  });

  it("rejects more than 10 benefits", () => {
    const result = createMembershipPlanSchema.safeParse({
      ownerId: "o1", clubId: "c1",
      name: "X", tier: "silver", price: 1, visitQuota: 1,
      hasExpiry: false,
      benefits: Array.from({ length: 11 }, (_, i) => `Benefit ${i}`),
    });
    expect(result.success).toBe(false);
  });
});

describe("createLockerPlanSchema", () => {
  it("accepts a locker plan with the right discriminator", () => {
    const result = createLockerPlanSchema.safeParse({
      ownerId: "o1", clubId: "c1",
      planType: "locker",
      name: "Loker Basic",
      visitQuota: 0,
      blendingFeePerSession: 10000,
    });
    expect(result.success).toBe(true);
  });

  it("rejects without planType: 'locker'", () => {
    const result = createLockerPlanSchema.safeParse({
      ownerId: "o1", clubId: "c1",
      name: "Loker Basic",
      visitQuota: 0,
      blendingFeePerSession: 10000,
    });
    expect(result.success).toBe(false);
  });
});

describe("lockerRecordVisitSchema", () => {
  const base = {
    ...tenant,
    membershipId: "m-1",
    customerId: "cust-1",
    guestCount: 1,
    paymentType: "credits" as const,
  };

  it("accepts credits payment", () => {
    expect(lockerRecordVisitSchema.safeParse(base).success).toBe(true);
  });

  it("accepts cash payment", () => {
    expect(lockerRecordVisitSchema.safeParse({ ...base, paymentType: "cash" }).success).toBe(true);
  });

  it("rejects guestCount > 20", () => {
    expect(lockerRecordVisitSchema.safeParse({ ...base, guestCount: 21 }).success).toBe(false);
  });

  it("rejects guestCount < 1", () => {
    expect(lockerRecordVisitSchema.safeParse({ ...base, guestCount: 0 }).success).toBe(false);
  });
});
