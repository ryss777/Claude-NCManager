import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole, requireAuth } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import {
  openShiftSchema,
  closeShiftSchema,
  createJournalEntrySchema,
} from "@nc-manager/validation";
import { COLLECTIONS, ACCOUNT_CODES, SHIFT_DISCREPANCY_THRESHOLD } from "@nc-manager/shared-constants";
import type { AccountCode } from "@nc-manager/shared-types";
import { writeJournalEntry, calculateExpectedCash } from "./finance.helpers";

// ── Shift Management ──────────────────────────────────────────────────────────

export const finance_openShift = onCall(async (request) => {
  requireRole(request, "operator");

  const payload = validatePayload(openShiftSchema, request.data);
  const { ownerId, clubId, operationId, operatorId, deviceId, openingCash } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  // Prevent duplicate open shifts on the same device
  const existingShift = await db
    .collection(COLLECTIONS.SHIFTS(ownerId, clubId))
    .where("deviceId", "==", deviceId)
    .where("status", "==", "open")
    .limit(1)
    .get();

  if (!existingShift.empty) {
    const existing = existingShift.docs[0];
    if (existing !== undefined) {
      throw new HttpsError(
        "already-exists",
        `Device already has open shift: ${existing.id}`
      );
    }
  }

  const now = new Date().toISOString();
  const shiftRef = db.collection(COLLECTIONS.SHIFTS(ownerId, clubId)).doc();

  await db.runTransaction(async (tx) => {
    tx.set(shiftRef, {
      id: shiftRef.id,
      ownerId,
      clubId,
      operatorId,
      deviceId,
      openingCash,
      status: "open",
      totalTransactions: 0,
      totalRevenue: 0,
      openedAt: now,
      closedAt: null,
      notes: null,
    });

    await markOperationComplete(tx, operationId, idempotencyPath, {
      shiftId: shiftRef.id,
    });
  });

  return { shiftId: shiftRef.id };
});

export const finance_closeShift = onCall(async (request) => {
  requireRole(request, "operator");

  const payload = validatePayload(closeShiftSchema, request.data);
  const { ownerId, clubId, operationId, shiftId, operatorId, actualCash, notes } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const shiftRef = db.collection(COLLECTIONS.SHIFTS(ownerId, clubId)).doc(shiftId);
  const shiftSnap = await shiftRef.get();

  if (!shiftSnap.exists) {
    throw new HttpsError("not-found", "Shift not found");
  }

  const shift = shiftSnap.data()!;

  if ((shift["status"] as string) !== "open") {
    throw new HttpsError("failed-precondition", "Shift is already closed");
  }

  if ((shift["operatorId"] as string) !== operatorId) {
    throw new HttpsError("permission-denied", "Only the shift owner can close it");
  }

  const openingCash = shift["openingCash"] as number;
  const expectedCash = await calculateExpectedCash(ownerId, clubId, shiftId, openingCash);
  const cashDiscrepancy = actualCash - expectedCash;
  const now = new Date().toISOString();

  await db.runTransaction(async (tx) => {
    tx.update(shiftRef, {
      status: "closed",
      actualCash,
      expectedCash,
      cashDiscrepancy,
      closedAt: now,
      notes: notes ?? null,
    });

    writeJournalEntry(tx, {
      ownerId,
      clubId,
      entryType: "shift_close",
      amount: actualCash,
      debitAccount: ACCOUNT_CODES.CASH as AccountCode,
      creditAccount: ACCOUNT_CODES.CASH as AccountCode,
      description: `Shift closed — expected ${expectedCash}, actual ${actualCash}, discrepancy ${cashDiscrepancy}`,
      requestId: payload.requestId,
      operationId,
      referenceId: shiftId,
      referenceType: "shift",
      shiftId,
      operatorId,
    });

    await markOperationComplete(tx, operationId, idempotencyPath, { shiftId });
  });

  const hasDiscrepancy = Math.abs(cashDiscrepancy) > SHIFT_DISCREPANCY_THRESHOLD;

  return { shiftId, cashDiscrepancy, hasDiscrepancy };
});

// ── Manual Journal Entry (owner only) ────────────────────────────────────────

export const finance_createJournalEntry = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(createJournalEntrySchema, request.data);
  const { ownerId, clubId, operationId } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  let entryId: string;

  await db.runTransaction(async (tx) => {
    entryId = writeJournalEntry(tx, {
      ownerId,
      clubId,
      entryType: payload.entryType,
      amount: payload.amount,
      debitAccount: payload.debitAccount as AccountCode,
      creditAccount: payload.creditAccount as AccountCode,
      description: payload.description,
      requestId: payload.requestId,
      operationId,
      referenceId: payload.referenceId ?? undefined,
      referenceType: undefined,
      shiftId: payload.shiftId ?? undefined,
    });

    await markOperationComplete(tx, operationId, idempotencyPath, { entryId: entryId! });
  });

  return { entryId: entryId! };
});
