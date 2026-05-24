import { z } from "zod";
import { idempotencySchema, tenantRefSchema } from "./common.schemas";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD");

export const createCompetitionSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    name:      z.string().min(1, "Nama lomba wajib diisi").max(200),
    startDate: isoDate,
    endDate:   isoDate,
    adminFee:  z.number().min(0).default(0),
  });

export type CreateCompetitionInput = z.infer<typeof createCompetitionSchema>;

export const extendCompetitionSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    competitionId: z.string().min(1),
    newEndDate:    isoDate,
  });

export type ExtendCompetitionInput = z.infer<typeof extendCompetitionSchema>;

export const addParticipantSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    competitionId: z.string().min(1),
    type:          z.enum(["customer", "guest"]),
    customerId:    z.string().min(1).optional(),
    guestName:     z.string().min(1).max(200).optional(),
  });

export type AddParticipantInput = z.infer<typeof addParticipantSchema>;

export const removeParticipantSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    competitionId: z.string().min(1),
    participantId: z.string().min(1),
  });

export type RemoveParticipantInput = z.infer<typeof removeParticipantSchema>;
