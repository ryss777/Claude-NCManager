import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import { recordDebtPaymentSchema } from "@nc-manager/validation";
import { COLLECTIONS, ACCOUNT_CODES } from "@nc-manager/shared-constants";
import type { AccountCode } from "@nc-manager/shared-types";
import { writeJournalEntry } from "../finance/finance.helpers";

// ── debt_recordPayment ────────────────────────────────────────────────────────
//
// Records a (partial or full) payment against an outstanding debt.
// Debits CASH, credits ACCOUNTS_RECEIVABLE.

export const debt_recordPayment = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(recordDebtPaymentSchema, request.data);
  const { ownerId, clubId, operationId, debtId, amount, paymentMethod } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const debtRef = db.collection(COLLECTIONS.DEBTS(ownerId, clubId)).doc(debtId);
  const debtSnap = await debtRef.get();
  if (!debtSnap.exists) throw new HttpsError("not-found", "Debt record not found");

  const debt = debtSnap.data()!;
  if ((debt["status"] as string) === "paid") {
    throw new HttpsError("failed-precondition", "Utang ini sudah lunas");
  }

  const remainingAmount = debt["remainingAmount"] as number;
  if (amount > remainingAmount) {
    throw new HttpsError(
      "invalid-argument",
      `Jumlah bayar (${amount}) melebihi sisa utang (${remainingAmount})`
    );
  }

  const now = new Date().toISOString();
  const newPaidAmount = (debt["paidAmount"] as number) + amount;
  const newRemainingAmount = remainingAmount - amount;
  const newStatus = newRemainingAmount <= 0 ? "paid" : "partial";

  const newPayment = {
    amount,
    paymentMethod,
    notes: payload.notes ?? null,
    paidAt: now,
  };

  await db.runTransaction(async (tx) => {
    tx.update(debtRef, {
      paidAmount: newPaidAmount,
      remainingAmount: newRemainingAmount,
      status: newStatus,
      payments: [...((debt["payments"] as unknown[]) ?? []), newPayment],
      updatedAt: now,
    });

    writeJournalEntry(tx, {
      ownerId, clubId,
      entryType: "debt_payment",
      amount,
      debitAccount: ACCOUNT_CODES.CASH as AccountCode,
      creditAccount: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE as AccountCode,
      description: `Pembayaran utang — ${debt["referenceLabel"] as string} untuk pelanggan ${debt["customerId"] as string}${payload.notes ? ` (${payload.notes})` : ""}`,
      requestId: payload.requestId,
      operationId,
      referenceId: debtId,
      referenceType: "debt",
    });

    await markOperationComplete(tx, operationId, idempotencyPath, {
      debtId, paidAmount: newPaidAmount, remainingAmount: newRemainingAmount, status: newStatus,
    });
  });

  return { debtId, paidAmount: newPaidAmount, remainingAmount: newRemainingAmount, status: newStatus };
});
