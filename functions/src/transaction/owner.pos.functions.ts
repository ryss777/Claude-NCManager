import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import { ownerSaleSchema } from "@nc-manager/validation";
import { COLLECTIONS, ACCOUNT_CODES } from "@nc-manager/shared-constants";
import type { AccountCode } from "@nc-manager/shared-types";
import { writeJournalEntry } from "../finance/finance.helpers";

// ── pos_ownerSale ─────────────────────────────────────────────────────────────
//
// Owner-initiated sale — no shift required. Transaction is created and
// completed atomically in a single call. Writes a SALES_REVENUE journal entry.

export const pos_ownerSale = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(ownerSaleSchema, request.data);
  const { ownerId, clubId, operationId } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const subtotal = payload.items.reduce((sum, item) => sum + item.subtotal, 0);
  const discount = payload.discount ?? 0;
  const total = subtotal - discount;
  const change = payload.amountPaid - total;
  const now = new Date().toISOString();

  const debitAccount: AccountCode =
    payload.paymentMethod === "transfer"
      ? (ACCOUNT_CODES.CASH as AccountCode)   // treat transfer as cash for journal
      : (ACCOUNT_CODES.CASH as AccountCode);

  const txRef = db.collection(COLLECTIONS.TRANSACTIONS(ownerId, clubId)).doc();

  await db.runTransaction(async (tx) => {
    tx.set(txRef, {
      id: txRef.id,
      ownerId,
      clubId,
      operatorId: null,
      deviceId: null,
      shiftId: null,
      customerId: payload.customerId ?? null,
      membershipId: null,
      items: payload.items,
      subtotal,
      discount,
      total,
      paymentMethod: payload.paymentMethod,
      amountPaid: payload.amountPaid,
      change,
      notes: payload.notes ?? null,
      status: "completed",
      requestId: payload.requestId,
      operationId,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
      reversalReason: null,
      reversedTransactionId: null,
      createdBy: "owner",
    });

    writeJournalEntry(tx, {
      ownerId,
      clubId,
      entryType: "sale",
      amount: total,
      debitAccount,
      creditAccount: ACCOUNT_CODES.SALES_REVENUE as AccountCode,
      description: `Owner sale — transaction ${txRef.id}${payload.notes ? ` (${payload.notes})` : ""}`,
      requestId: payload.requestId,
      operationId,
      referenceId: txRef.id,
      referenceType: "transaction",
      operatorId: request.auth!.uid,
    });

    await markOperationComplete(tx, operationId, idempotencyPath, {
      transactionId: txRef.id,
    });
  });

  return { transactionId: txRef.id, total, change };
});
