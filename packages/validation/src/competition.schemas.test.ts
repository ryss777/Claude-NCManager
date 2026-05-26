import { describe, it, expect } from "vitest";
import {
  scoringWeightsSchema,
  createCompetitionSchema,
  recordMeasurementSchema,
  recordPaymentSchema,
  forceStartSchema,
  forceEndSchema,
  addParticipantSchema,
} from "./competition.schemas";

const tenant = {
  ownerId: "o1",
  clubId: "c1",
  requestId: "11111111-1111-1111-1111-111111111111",
  operationId: "22222222-2222-2222-2222-222222222222",
};

describe("scoringWeightsSchema", () => {
  it("accepts weights summing to exactly 100", () => {
    const result = scoringWeightsSchema.safeParse({ bodyFat: 50, abdominalFat: 30, weightPct: 20 });
    expect(result.success).toBe(true);
  });

  it("rejects weights summing to 99", () => {
    const result = scoringWeightsSchema.safeParse({ bodyFat: 50, abdominalFat: 30, weightPct: 19 });
    expect(result.success).toBe(false);
  });

  it("rejects weights summing to 101", () => {
    const result = scoringWeightsSchema.safeParse({ bodyFat: 50, abdominalFat: 30, weightPct: 21 });
    expect(result.success).toBe(false);
  });

  it("rejects a negative weight", () => {
    const result = scoringWeightsSchema.safeParse({ bodyFat: -10, abdominalFat: 60, weightPct: 50 });
    expect(result.success).toBe(false);
  });

  it("rejects a non-integer weight", () => {
    const result = scoringWeightsSchema.safeParse({ bodyFat: 50.5, abdominalFat: 29.5, weightPct: 20 });
    expect(result.success).toBe(false);
  });
});

describe("createCompetitionSchema", () => {
  it("accepts a competition with custom scoring weights", () => {
    const result = createCompetitionSchema.safeParse({
      ...tenant,
      name: "Slim-A-Thon",
      startDate: "2026-01-01",
      endDate: "2026-02-01",
      adminFee: 50000,
      scoringWeights: { bodyFat: 40, abdominalFat: 40, weightPct: 20 },
    });
    expect(result.success).toBe(true);
  });

  it("accepts a competition without scoringWeights (defaults applied in CF)", () => {
    const result = createCompetitionSchema.safeParse({
      ...tenant,
      name: "Slim-A-Thon",
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed startDate", () => {
    const result = createCompetitionSchema.safeParse({
      ...tenant,
      name: "Slim-A-Thon",
      startDate: "01/01/2026",   // wrong format
      endDate: "2026-02-01",
    });
    expect(result.success).toBe(false);
  });
});

describe("recordMeasurementSchema", () => {
  const base = {
    ...tenant,
    competitionId: "comp-1",
    participantId: "part-1",
    weightKg: 70,
    bodyFatPct: 25,
    abdominalFatPct: 20,
  };

  it("accepts required-only measurement", () => {
    const result = recordMeasurementSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it("rejects weightKg <= 0", () => {
    const result = recordMeasurementSchema.safeParse({ ...base, weightKg: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects bodyFatPct above 100", () => {
    const result = recordMeasurementSchema.safeParse({ ...base, bodyFatPct: 101 });
    expect(result.success).toBe(false);
  });

  it("accepts optional fields when present", () => {
    const result = recordMeasurementSchema.safeParse({
      ...base,
      boneMassKg: 3.2,
      metabolicAge: 35,
      muscleMassKg: 50,
      waterPct: 55,
    });
    expect(result.success).toBe(true);
  });
});

describe("recordPaymentSchema", () => {
  it("rejects zero amount", () => {
    const result = recordPaymentSchema.safeParse({
      ...tenant, competitionId: "c", participantId: "p", amount: 0,
    });
    expect(result.success).toBe(false);
  });

  it("accepts positive amount", () => {
    const result = recordPaymentSchema.safeParse({
      ...tenant, competitionId: "c", participantId: "p", amount: 10000,
    });
    expect(result.success).toBe(true);
  });
});

describe("forceStartSchema + forceEndSchema", () => {
  it("forceStart accepts optional newEndDate", () => {
    const result = forceStartSchema.safeParse({
      ...tenant, competitionId: "c", newEndDate: "2026-12-31",
    });
    expect(result.success).toBe(true);
  });

  it("forceStart accepts payload without newEndDate", () => {
    const result = forceStartSchema.safeParse({ ...tenant, competitionId: "c" });
    expect(result.success).toBe(true);
  });

  it("forceEnd needs only competitionId", () => {
    const result = forceEndSchema.safeParse({ ...tenant, competitionId: "c" });
    expect(result.success).toBe(true);
  });
});

describe("addParticipantSchema", () => {
  it("accepts customer type with customerId", () => {
    const result = addParticipantSchema.safeParse({
      ...tenant, competitionId: "c", type: "customer", customerId: "cust-1",
    });
    expect(result.success).toBe(true);
  });

  it("accepts guest type with guestName", () => {
    const result = addParticipantSchema.safeParse({
      ...tenant, competitionId: "c", type: "guest", guestName: "Walk-in",
    });
    expect(result.success).toBe(true);
  });
});
