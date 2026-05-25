import { z } from "zod";
import { idempotencySchema, tenantRefSchema } from "./common.schemas";

export const createMembershipPlanSchema = tenantRefSchema
  .extend({
    name: z.string().min(1).max(100),
    tier: z.enum(["basic", "silver", "gold", "platinum"]),
    price: z.number().min(0),
    visitQuota: z.number().int().min(1),
    hasExpiry: z.boolean().default(true),
    durationDays: z.number().int().min(1).max(3650).nullish(),
    benefits: z.array(z.string()).max(10),
  })
  .refine(
    (d) => !d.hasExpiry || (d.durationDays != null && d.durationDays >= 1),
    { message: "durationDays wajib diisi jika hasExpiry aktif", path: ["durationDays"] }
  );

export const activateMembershipSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    customerId: z.string().min(1),
    planId: z.string().min(1),
    transactionId: z.string().min(1),
    amountPaid: z.number().min(0).nullish(),
    paymentMethod: z.enum(["cash", "transfer"]).nullish(),
    // For locker plans only: number of sessions to purchase upfront.
    // If provided, overrides the plan's visitQuota and records a transaction.
    lockerSessions: z.number().int().min(1).nullish(),
  });

export const deductVisitSchema = tenantRefSchema.merge(idempotencySchema).extend({
  membershipId: z.string().min(1),
  customerId: z.string().min(1),
  transactionId: z.string().min(1),
});

export const upgradeMembershipSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    currentMembershipId: z.string().min(1),
    newPlanId: z.string().min(1),
    customerId: z.string().min(1),
    transactionId: z.string().min(1),
  });

export const deactivatePlanSchema = tenantRefSchema.extend({
  planId: z.string().min(1),
});

export const deletePlanSchema = tenantRefSchema.merge(idempotencySchema).extend({
  planId: z.string().min(1),
});

export type ActivateMembershipInput = z.infer<typeof activateMembershipSchema>;

// ── Locker plan ───────────────────────────────────────────────────────────────

export const createLockerPlanSchema = tenantRefSchema
  .extend({
    planType: z.literal("locker"),
    name: z.string().min(1).max(100),
    visitQuota: z.number().int().min(0).default(0),
    blendingFeePerSession: z.number().min(0),
    hasExpiry: z.boolean().default(false),
    durationDays: z.number().int().min(1).max(3650).nullish(),
    benefits: z.array(z.string()).max(10).default([]),
  })
  .refine(
    (d) => !d.hasExpiry || (d.durationDays != null && d.durationDays >= 1),
    { message: "durationDays wajib diisi jika hasExpiry aktif", path: ["durationDays"] }
  );

export const lockerTopUpSchema = tenantRefSchema.merge(idempotencySchema).extend({
  membershipId: z.string().min(1),
  customerId: z.string().min(1),
  sessions: z.number().int().min(1),
});

export const lockerRecordVisitSchema = tenantRefSchema.merge(idempotencySchema).extend({
  membershipId: z.string().min(1),
  customerId: z.string().min(1),
  guestCount: z.number().int().min(1).max(20),
  paymentType: z.enum(["credits", "cash"]),
});
