import { z } from "zod";
import { idempotencySchema, tenantRefSchema } from "./common.schemas";

export const createMembershipPlanSchema = tenantRefSchema
  .extend({
    name: z.string().min(1).max(100),
    tier: z.enum(["basic", "silver", "gold", "platinum"]),
    price: z.number().min(0),
    visitQuota: z.number().int().min(1),
    hasExpiry: z.boolean().default(true),
    durationDays: z.number().int().min(1).max(3650).optional(),
    benefits: z.array(z.string()).max(10),
  })
  .refine(
    (d) => !d.hasExpiry || (d.durationDays !== undefined && d.durationDays >= 1),
    { message: "durationDays wajib diisi jika hasExpiry aktif", path: ["durationDays"] }
  );

export const activateMembershipSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    customerId: z.string().min(1),
    planId: z.string().min(1),
    transactionId: z.string().min(1),
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

export type ActivateMembershipInput = z.infer<typeof activateMembershipSchema>;
