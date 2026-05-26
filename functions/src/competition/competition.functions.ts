import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { DocumentReference, DocumentData, Transaction } from "firebase-admin/firestore";
import { db } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import {
  createCompetitionSchema,
  extendCompetitionSchema,
  addParticipantSchema,
  removeParticipantSchema,
  recordPaymentSchema,
  recordMeasurementSchema,
  forceStartSchema,
  forceEndSchema,
  updateScoringWeightsSchema,
  DEFAULT_SCORING_WEIGHTS,
} from "@nc-manager/validation";
import { COLLECTIONS } from "@nc-manager/shared-constants";
import { computeStatus, effectiveStatus } from "./competition.helpers";

// ── Helpers ───────────────────────────────────────────────────────────────────

function writeLog(
  tx: Transaction,
  logCollPath: string,
  entry: Record<string, unknown>,
  now: string
): void {
  const logRef = db.collection(logCollPath).doc();
  tx.set(logRef, { ...entry, createdAt: now });
}

// ── competition_create ────────────────────────────────────────────────────────
//
// Creates a new competition for a club.

export const competition_create = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(createCompetitionSchema, request.data);
  const { ownerId, clubId, operationId, name, startDate, endDate, adminFee, scoringWeights } = payload;

  if (endDate < startDate) {
    throw new HttpsError("invalid-argument", "Tanggal selesai tidak boleh sebelum tanggal mulai");
  }

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const now = new Date().toISOString();
  const compRef = db.collection(COLLECTIONS.COMPETITIONS(ownerId, clubId)).doc();

  await db.runTransaction(async (tx) => {
    tx.set(compRef, {
      name,
      adminFee:       adminFee ?? 0,
      startDate,
      endDate,
      status:         computeStatus(startDate, endDate),
      participantCount: 0,
      scoringWeights: scoringWeights ?? DEFAULT_SCORING_WEIGHTS,
      createdAt:      now,
      updatedAt:      now,
    });
    await markOperationComplete(tx, operationId, idempotencyPath, { competitionId: compRef.id });
  });

  return { competitionId: compRef.id };
});

// ── competition_extend ────────────────────────────────────────────────────────
//
// Extends the end date of an existing competition.

export const competition_extend = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(extendCompetitionSchema, request.data);
  const { ownerId, clubId, operationId, competitionId, newEndDate } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const compRef = db.collection(COLLECTIONS.COMPETITIONS(ownerId, clubId)).doc(competitionId);
  const compSnap = await compRef.get();
  if (!compSnap.exists) throw new HttpsError("not-found", "Lomba tidak ditemukan");

  const comp = compSnap.data()!;
  const currentEndDate = comp["endDate"] as string;

  if (effectiveStatus(comp) === "finished") {
    throw new HttpsError("failed-precondition", "Lomba sudah selesai, tidak bisa diperpanjang");
  }

  if (newEndDate <= currentEndDate) {
    throw new HttpsError(
      "invalid-argument",
      `Tanggal baru (${newEndDate}) harus lebih dari tanggal selesai saat ini (${currentEndDate})`
    );
  }

  const now = new Date().toISOString();

  await db.runTransaction(async (tx) => {
    tx.update(compRef, {
      endDate: newEndDate,
      status: computeStatus(comp["startDate"] as string, newEndDate),
      updatedAt: now,
    });
    await markOperationComplete(tx, operationId, idempotencyPath, { ok: true });
  });

  return { ok: true };
});

// ── competition_addParticipant ────────────────────────────────────────────────
//
// Adds a participant to a competition. If the participant is a registered
// customer, their `competitionIds` array is also updated for quick lookup.

export const competition_addParticipant = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(addParticipantSchema, request.data);
  const { ownerId, clubId, operationId, competitionId, type, customerId, guestName } = payload;

  if (type === "customer" && !customerId) {
    throw new HttpsError("invalid-argument", "customerId diperlukan untuk peserta pelanggan");
  }
  if (type === "guest" && !guestName?.trim()) {
    throw new HttpsError("invalid-argument", "guestName diperlukan untuk peserta tamu");
  }

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const compRef = db.collection(COLLECTIONS.COMPETITIONS(ownerId, clubId)).doc(competitionId);
  const compSnap = await compRef.get();
  if (!compSnap.exists) throw new HttpsError("not-found", "Lomba tidak ditemukan");

  if (effectiveStatus(compSnap.data()!) === "finished") {
    throw new HttpsError("failed-precondition", "Lomba sudah selesai, tidak bisa menambah peserta");
  }

  let displayName = guestName?.trim() ?? "";
  let customerRef: DocumentReference<DocumentData> | null = null;

  if (type === "customer" && customerId) {
    customerRef = db.collection(COLLECTIONS.CUSTOMERS(ownerId, clubId)).doc(customerId);

    // Pre-check customer existence + duplicate registration. Counter math
    // (participantCount + competitionIds array) happens inside the tx below
    // so concurrent calls can't both increment from the same snapshot.
    const [custSnap, dupSnap] = await Promise.all([
      customerRef.get(),
      db.collection(COLLECTIONS.COMPETITION_PARTICIPANTS(ownerId, clubId, competitionId))
        .where("customerId", "==", customerId)
        .limit(1)
        .get(),
    ]);
    if (!custSnap.exists) throw new HttpsError("not-found", "Pelanggan tidak ditemukan");
    if (!dupSnap.empty) {
      throw new HttpsError("already-exists", "Pelanggan ini sudah terdaftar di lomba");
    }
    displayName = (custSnap.data()!["displayName"] as string) ?? customerId;
  }

  const now = new Date().toISOString();
  const participantRef = db
    .collection(COLLECTIONS.COMPETITION_PARTICIPANTS(ownerId, clubId, competitionId))
    .doc();
  const logCollPath = COLLECTIONS.COMPETITION_ACTIVITY_LOG(ownerId, clubId, competitionId);

  await db.runTransaction(async (tx) => {
    // Re-read counter sources inside the tx — see comment above.
    const freshCompSnap = await tx.get(compRef);
    const currentCount = (freshCompSnap.data()?.["participantCount"] as number | undefined) ?? 0;
    const freshCustSnap = customerRef ? await tx.get(customerRef) : null;
    const existingIds = (freshCustSnap?.data()?.["competitionIds"] as string[] | undefined) ?? [];

    tx.set(participantRef, {
      competitionId,
      type,
      customerId:  type === "customer" ? customerId : null,
      displayName,
      amountPaid:       0,
      measurementCount: 0,
      joinedAt: now,
    });

    // Manual increment — avoids FieldValue.increment which has emulator quirks
    tx.update(compRef, {
      participantCount: currentCount + 1,
      updatedAt: now,
    });

    // Denormalize competition ID onto customer for quick badge lookup
    if (customerRef) {
      const updatedIds = existingIds.includes(competitionId)
        ? existingIds
        : [...existingIds, competitionId];
      tx.update(customerRef, {
        competitionIds: updatedIds,
        updatedAt: now,
      });
    }

    writeLog(tx, logCollPath, {
      type:            "participant_added",
      participantId:   participantRef.id,
      participantName: displayName,
      participantType: type,
    }, now);

    await markOperationComplete(tx, operationId, idempotencyPath, { participantId: participantRef.id });
  });

  return { participantId: participantRef.id };
});

// ── competition_removeParticipant ─────────────────────────────────────────────
//
// Removes a participant from a competition, updating the participant count
// and (for customer participants) removing the competition from their profile.

export const competition_removeParticipant = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(removeParticipantSchema, request.data);
  const { ownerId, clubId, operationId, competitionId, participantId, reason } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const compRef = db.collection(COLLECTIONS.COMPETITIONS(ownerId, clubId)).doc(competitionId);
  const participantRef = db
    .collection(COLLECTIONS.COMPETITION_PARTICIPANTS(ownerId, clubId, competitionId))
    .doc(participantId);

  const [compSnap, partSnap] = await Promise.all([compRef.get(), participantRef.get()]);
  if (!compSnap.exists) throw new HttpsError("not-found", "Lomba tidak ditemukan");
  if (!partSnap.exists) throw new HttpsError("not-found", "Peserta tidak ditemukan");

  if (effectiveStatus(compSnap.data()!) === "finished") {
    throw new HttpsError("failed-precondition", "Lomba sudah selesai, tidak bisa menghapus peserta");
  }

  const participant = partSnap.data()!;
  const now = new Date().toISOString();

  const customerRef = participant["type"] === "customer" && participant["customerId"]
    ? db.collection(COLLECTIONS.CUSTOMERS(ownerId, clubId)).doc(participant["customerId"] as string)
    : null;

  const logCollPath = COLLECTIONS.COMPETITION_ACTIVITY_LOG(ownerId, clubId, competitionId);

  await db.runTransaction(async (tx) => {
    // Re-read counter sources inside the tx so concurrent removes don't
    // both decrement from the same stale snapshot.
    const freshCompSnap = await tx.get(compRef);
    const currentCount = (freshCompSnap.data()?.["participantCount"] as number | undefined) ?? 0;
    const freshCustSnap = customerRef ? await tx.get(customerRef) : null;
    const existingIds = (freshCustSnap?.data()?.["competitionIds"] as string[] | undefined) ?? [];

    tx.delete(participantRef);

    // Manual decrement — avoids FieldValue.increment which has emulator quirks
    tx.update(compRef, {
      participantCount: Math.max(0, currentCount - 1),
      updatedAt: now,
    });

    // Remove competition ID from customer's list
    if (customerRef && freshCustSnap?.exists) {
      const updatedIds = existingIds.filter((id) => id !== competitionId);
      tx.update(customerRef, {
        competitionIds: updatedIds,
        updatedAt: now,
      });
    }

    writeLog(tx, logCollPath, {
      type:            "participant_removed",
      participantId,
      participantName: participant["displayName"] as string,
      reason,
    }, now);

    await markOperationComplete(tx, operationId, idempotencyPath, { ok: true });
  });

  return { ok: true };
});

// ── competition_recordPayment ─────────────────────────────────────────────────
//
// Records a (partial or full) admin-fee payment for a participant.
// Accumulates on top of any previously recorded amount; rejects over-payment.

export const competition_recordPayment = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(recordPaymentSchema, request.data);
  const { ownerId, clubId, operationId, competitionId, participantId, amount } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const compRef = db.collection(COLLECTIONS.COMPETITIONS(ownerId, clubId)).doc(competitionId);
  const partRef = db
    .collection(COLLECTIONS.COMPETITION_PARTICIPANTS(ownerId, clubId, competitionId))
    .doc(participantId);

  const [compSnap, partSnap] = await Promise.all([compRef.get(), partRef.get()]);
  if (!compSnap.exists) throw new HttpsError("not-found", "Lomba tidak ditemukan");
  if (!partSnap.exists) throw new HttpsError("not-found", "Peserta tidak ditemukan");

  if (effectiveStatus(compSnap.data()!) === "finished") {
    throw new HttpsError("failed-precondition", "Lomba sudah selesai, tidak bisa mencatat pembayaran baru");
  }

  const adminFee = (compSnap.data()!["adminFee"] as number) ?? 0;
  const now = new Date().toISOString();
  const logCollPath = COLLECTIONS.COMPETITION_ACTIVITY_LOG(ownerId, clubId, competitionId);
  let newPaid = 0;

  await db.runTransaction(async (tx) => {
    // Re-read inside the tx so two concurrent payments can't both compute
    // newPaid from the same currentPaid (which would overcount the total).
    const freshPartSnap = await tx.get(partRef);
    const currentPaid = (freshPartSnap.data()?.["amountPaid"] as number | undefined) ?? 0;
    newPaid = currentPaid + amount;

    if (newPaid > adminFee) {
      const remaining = adminFee - currentPaid;
      throw new HttpsError(
        "invalid-argument",
        `Jumlah melebihi sisa tagihan. Sisa: Rp ${remaining.toLocaleString("id-ID")}`
      );
    }

    tx.update(partRef, { amountPaid: newPaid, updatedAt: now });

    writeLog(tx, logCollPath, {
      type:            "payment_recorded",
      participantId,
      participantName: freshPartSnap.data()?.["displayName"] as string,
      amount,
      totalPaid:       newPaid,
      adminFee,
    }, now);

    await markOperationComplete(tx, operationId, idempotencyPath, { newAmountPaid: newPaid });
  });

  return { newAmountPaid: newPaid };
});

// ── competition_recordMeasurement ─────────────────────────────────────────────
//
// Saves one body-measurement round for a participant (initial or follow-up).
// Required: weightKg, bodyFatPct, abdominalFatPct.
// Optional: boneMassKg, metabolicAge, muscleMassKg, waterPct.

export const competition_recordMeasurement = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(recordMeasurementSchema, request.data);
  const {
    ownerId, clubId, operationId, competitionId, participantId,
    weightKg, bodyFatPct, abdominalFatPct,
    boneMassKg, metabolicAge, muscleMassKg, waterPct,
  } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  // Pre-check participant exists. Counter math re-reads inside tx.
  const partRef = db
    .collection(COLLECTIONS.COMPETITION_PARTICIPANTS(ownerId, clubId, competitionId))
    .doc(participantId);
  const partSnap = await partRef.get();
  if (!partSnap.exists) throw new HttpsError("not-found", "Peserta tidak ditemukan");

  const now = new Date().toISOString();
  const measurementRef = db
    .collection(COLLECTIONS.COMPETITION_PARTICIPANT_MEASUREMENTS(ownerId, clubId, competitionId, participantId))
    .doc();

  const data: Record<string, unknown> = {
    weightKg,
    bodyFatPct,
    abdominalFatPct,
    recordedAt: now,
    createdAt:  now,
  };
  if (boneMassKg   !== undefined) data["boneMassKg"]   = boneMassKg;
  if (metabolicAge !== undefined) data["metabolicAge"] = metabolicAge;
  if (muscleMassKg !== undefined) data["muscleMassKg"] = muscleMassKg;
  if (waterPct     !== undefined) data["waterPct"]     = waterPct;

  await db.runTransaction(async (tx) => {
    // Re-read inside tx so concurrent recordings don't both increment from
    // the same stale measurementCount.
    const freshPartSnap = await tx.get(partRef);
    const currentMeasurementCount = (freshPartSnap.data()?.["measurementCount"] as number | undefined) ?? 0;

    tx.set(measurementRef, data);
    tx.update(partRef, { measurementCount: currentMeasurementCount + 1, updatedAt: now });
    await markOperationComplete(tx, operationId, idempotencyPath, { measurementId: measurementRef.id });
  });

  return { measurementId: measurementRef.id };
});

// ── competition_forceStart ────────────────────────────────────────────────────
//
// Allows the owner to start a competition before its scheduled startDate.
// Only valid for "upcoming" competitions. The endDate is never changed —
// the competition still finishes on the originally planned date.

export const competition_forceStart = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(forceStartSchema, request.data);
  const { ownerId, clubId, operationId, competitionId, newEndDate } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const compRef = db.collection(COLLECTIONS.COMPETITIONS(ownerId, clubId)).doc(competitionId);
  const compSnap = await compRef.get();
  if (!compSnap.exists) throw new HttpsError("not-found", "Lomba tidak ditemukan");

  const comp = compSnap.data()!;
  const today = new Date().toISOString().slice(0, 10);
  const currentStatus = effectiveStatus(comp);

  if (currentStatus === "active") {
    throw new HttpsError("failed-precondition", "Lomba sudah berjalan");
  }
  if (currentStatus === "finished") {
    throw new HttpsError("failed-precondition", "Lomba sudah selesai");
  }

  const effectiveEndDate = newEndDate ?? (comp["endDate"] as string);

  if (effectiveEndDate <= today) {
    throw new HttpsError("invalid-argument", "Tanggal selesai harus setelah hari ini");
  }

  const now = new Date().toISOString();
  const logCollPath = COLLECTIONS.COMPETITION_ACTIVITY_LOG(ownerId, clubId, competitionId);

  await db.runTransaction(async (tx) => {
    tx.update(compRef, {
      startDate: today,
      endDate:   effectiveEndDate,
      status:    "active",
      updatedAt: now,
    });
    writeLog(tx, logCollPath, {
      type:              "competition_started",
      originalStartDate: comp["startDate"] as string,
      originalEndDate:   comp["endDate"] as string,
      startedEarlyAt:    today,
      endDate:           effectiveEndDate,
    }, now);
    await markOperationComplete(tx, operationId, idempotencyPath, { ok: true });
  });

  return { ok: true };
});

// ── competition_forceEnd ──────────────────────────────────────────────────────
//
// Allows the owner to manually end an active competition before its endDate.
// Sets endDate = today and status = "finished".

export const competition_forceEnd = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(forceEndSchema, request.data);
  const { ownerId, clubId, operationId, competitionId } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const compRef = db.collection(COLLECTIONS.COMPETITIONS(ownerId, clubId)).doc(competitionId);
  const compSnap = await compRef.get();
  if (!compSnap.exists) throw new HttpsError("not-found", "Lomba tidak ditemukan");

  const comp = compSnap.data()!;
  const today = new Date().toISOString().slice(0, 10);
  const currentStatus = effectiveStatus(comp);

  if (currentStatus !== "active") {
    throw new HttpsError("failed-precondition", "Hanya lomba yang sedang berjalan yang bisa diselesaikan lebih awal");
  }

  const now = new Date().toISOString();
  const logCollPath = COLLECTIONS.COMPETITION_ACTIVITY_LOG(ownerId, clubId, competitionId);

  await db.runTransaction(async (tx) => {
    tx.update(compRef, {
      endDate:   today,
      status:    "finished",
      updatedAt: now,
    });
    writeLog(tx, logCollPath, {
      type:            "competition_ended",
      endedEarlyAt:    today,
      originalEndDate: comp["endDate"] as string,
    }, now);
    await markOperationComplete(tx, operationId, idempotencyPath, { ok: true });
  });

  return { ok: true };
});

// ── competition_updateScoringWeights ──────────────────────────────────────────
//
// Allows the owner to correct the scoring weights at any time (no status lock).
// bodyFat + abdominalFat + weightPct must equal 100.

export const competition_updateScoringWeights = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(updateScoringWeightsSchema, request.data);
  const { ownerId, clubId, operationId, competitionId, scoringWeights } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const compRef = db.collection(COLLECTIONS.COMPETITIONS(ownerId, clubId)).doc(competitionId);
  const compSnap = await compRef.get();
  if (!compSnap.exists) throw new HttpsError("not-found", "Lomba tidak ditemukan");

  const now = new Date().toISOString();

  await db.runTransaction(async (tx) => {
    tx.update(compRef, { scoringWeights, updatedAt: now });
    await markOperationComplete(tx, operationId, idempotencyPath, { ok: true });
  });

  return { ok: true };
});
