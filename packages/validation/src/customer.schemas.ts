import { z } from "zod";
import { tenantRefSchema, idempotencySchema } from "./common.schemas";

export const createCustomerSchema = tenantRefSchema.extend({
  displayName: z.string().min(1).max(100),
  phone: z.string().min(6).max(20).optional(),
  email: z.string().email().optional(),
  notes: z.string().max(200).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
