import { z } from "zod";

export const requestIdSchema = z
  .string()
  .uuid("requestId must be a valid UUID");

export const operationIdSchema = z
  .string()
  .uuid("operationId must be a valid UUID");

export const tenantRefSchema = z.object({
  ownerId: z.string().min(1),
  clubId: z.string().min(1),
});

export const idempotencySchema = z.object({
  requestId: requestIdSchema,
  operationId: operationIdSchema,
});

export const paginationSchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const dateRangeSchema = z.object({
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});
