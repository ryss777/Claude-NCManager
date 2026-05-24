import { onCall, HttpsError } from "firebase-functions/v2/https";
import type { DocumentReference, DocumentData } from "firebase-admin/firestore";
import { db } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import {
  createCompetitionSchema,
  extendCompetitionSchema,
  addParticipantSchema,
  removeParticipantSchema,
} from "@nc-manager/validation";
import { COLLECTIONS } from "@nc-manager/shared-constants";

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeStatus(startDate: string, endDate: string): "upcoming" | "active" | "finished" {
  const today = new Date().toISOString().slice(0, 10);
  if (today < startDate) return "upcoming";
  if (today > endDate) return "finished";
  return "active";
}

// ── competition_create ────────────────────────────────────────────────────────
//
// Creates a new competition for a club.

export const competition_create = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(createCompetitionSchema, request.data);
  const { ownerId, clubId, operationId, name, startDate, endDate, adminFee } = payload;

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
      adminFee: adminFee ?? 0,
      startDate,
      endDate,
      status: computeStatus(startDate, endDate),
      participantCount: 0,
      createdAt: now,
      updatedAt: now,
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

  let displayName = guestName?.trim() ?? "";
  let customerRef: DocumentReference<DocumentData> | null = null;
  let existingCompetitionIds: string[] = [];

  if (type === "customer" && customerId) {
    customerRef = db.collection(COLLECTIONS.CUSTOMERS(ownerId, clubId)).doc(customerId);
    const custSnap = await customerRef.get();
    if (!custSnap.exists) throw new HttpsError("not-found", "Pelanggan tidak ditemukan");
    const custData = custSnap.data()!;
    displayName = (custData["displayName"] as string) ?? customerId;
    existingCompetitionIds = (custData["competitionIds"] as string[]) ?? [];

    // Duplicate check
    const dupSnap = await db
      .collection(COLLECTIONS.COMPETITION_PARTICIPANTS(ownerId, clubId, competitionId))
      .where("customerId", "==", customerId)
      .limit(1)
      .get();
    if (!dupSnap.empty) {
      throw new HttpsError("already-exists", "Pelanggan ini sudah terdaftar di lomba");
    }
  }

  const now = new Date().toISOString();
  const currentCount = (compSnap.data()!["participantCount"] as number) ?? 0;
  const participantRef = db
    .collection(COLLECTIONS.COMPETITION_PARTICIPANTS(ownerId, clubId, competitionId))
    .doc();

  await db.runTransaction(async (tx) => {
    tx.set(participantRef, {
      competitionId,
      type,
      customerId:  type === "customer" ? customerId : null,
      displayName,
      joinedAt: now,
    });

    // Manual increment — avoids FieldValue.increment which has emulator quirks
    tx.update(compRef, {
      participantCount: currentCount + 1,
      updatedAt: now,
    });

    // Denormalize competition ID onto customer for quick badge lookup
    if (customerRef) {
      const updatedIds = existingCompetitionIds.includes(competitionId)
        ? existingCompetitionIds
        : [...existingCompetitionIds, competitionId];
      tx.update(customerRef, {
        competitionIds: updatedIds,
        updatedAt: now,
      });
    }

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
  const { ownerId, clubId, operationId, competitionId, participantId } = payload;

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

  const participant = partSnap.data()!;
  const currentCount = (compSnap.data()!["participantCount"] as number) ?? 0;
  const now = new Date().toISOString();

  let customerRef: DocumentReference<DocumentData> | null = null;
  let existingCompetitionIds: string[] = [];

  if (participant["type"] === "customer" && participant["customerId"]) {
    customerRef = db
      .collection(COLLECTIONS.CUSTOMERS(ownerId, clubId))
      .doc(participant["customerId"] as string);
    const custSnap = await customerRef.get();
    if (custSnap.exists) {
      existingCompetitionIds = (custSnap.data()!["competitionIds"] as string[]) ?? [];
    }
  }

  await db.runTransaction(async (tx) => {
    tx.delete(participantRef);

    // Manual decrement — avoids FieldValue.increment which has emulator quirks
    tx.update(compRef, {
      participantCount: Math.max(0, currentCount - 1),
      updatedAt: now,
    });

    // Remove competition ID from customer's list
    if (customerRef) {
      const updatedIds = existingCompetitionIds.filter((id) => id !== competitionId);
      tx.update(customerRef, {
        competitionIds: updatedIds,
        updatedAt: now,
      });
    }

    await markOperationComplete(tx, operationId, idempotencyPath, { ok: true });
  });

  return { ok: true };
});
