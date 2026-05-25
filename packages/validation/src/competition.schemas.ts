import { z } from "zod";
import { idempotencySchema, tenantRefSchema } from "./common.schemas";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD");

// ── Scoring weights ───────────────────────────────────────────────────────────
// Each field is an integer 0–100 representing percentage contribution.
// The three values must sum to exactly 100.

export const scoringWeightsSchema = z.object({
  bodyFat:      z.number().int().min(0).max(100),
  abdominalFat: z.number().int().min(0).max(100),
  weightPct:    z.number().int().min(0).max(100),
}).refine(
  (w) => w.bodyFat + w.abdominalFat + w.weightPct === 100,
  { message: "Total bobot harus tepat 100%" }
);

export type ScoringWeights = z.infer<typeof scoringWeightsSchema>;

export const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
  bodyFat: 50, abdominalFat: 30, weightPct: 20,
};

// ── Schemas ───────────────────────────────────────────────────────────────────

export const createCompetitionSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    name:           z.string().min(1, "Nama lomba wajib diisi").max(200),
    startDate:      isoDate,
    endDate:        isoDate,
    adminFee:       z.number().min(0).default(0),
    scoringWeights: scoringWeightsSchema.optional(), // defaults to DEFAULT_SCORING_WEIGHTS in CF
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
    reason:        z.string().min(1, "Alasan wajib diisi").max(500),
  });

export type RemoveParticipantInput = z.infer<typeof removeParticipantSchema>;

export const forceEndSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    competitionId: z.string().min(1),
  });

export type ForceEndInput = z.infer<typeof forceEndSchema>;

export const forceStartSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    competitionId: z.string().min(1),
    newEndDate:    isoDate.optional(), // if provided, overrides the existing endDate
  });

export type ForceStartInput = z.infer<typeof forceStartSchema>;

export const recordMeasurementSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    competitionId:   z.string().min(1),
    participantId:   z.string().min(1),
    // Required
    weightKg:        z.number().positive("Berat badan harus lebih dari 0"),
    bodyFatPct:      z.number().min(0).max(100),
    abdominalFatPct: z.number().min(0).max(100),
    // Optional
    boneMassKg:      z.number().positive().optional(),
    metabolicAge:    z.number().int().positive().optional(),
    muscleMassKg:    z.number().positive().optional(),
    waterPct:        z.number().min(0).max(100).optional(),
  });

export type RecordMeasurementInput = z.infer<typeof recordMeasurementSchema>;

export const updateScoringWeightsSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    competitionId:  z.string().min(1),
    scoringWeights: scoringWeightsSchema,
  });

export type UpdateScoringWeightsInput = z.infer<typeof updateScoringWeightsSchema>;

export const recordPaymentSchema = tenantRefSchema
  .merge(idempotencySchema)
  .extend({
    competitionId: z.string().min(1),
    participantId: z.string().min(1),
    amount:        z.number().positive("Jumlah bayar harus lebih dari 0"),
  });

export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
