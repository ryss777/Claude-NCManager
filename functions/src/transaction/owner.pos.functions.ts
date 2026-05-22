import { onCall } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import { ownerSaleSchema } from "@nc-manager/validation";
import { COLLECTIONS, ACCOUNT_CODES } from "@nc-manager/shared-constants";
import type { AccountCode } from "@nc-manager/shared-types";
import { writeJournalEntry } from "../finance/finance.helpers";
import {
  readInventorySnaps,
  writeInventoryMovements,
  loadRecipesForItems,
  buildIngredientDeductions,
  readIngredientSnaps,
  writeIngredientDeductions,
} from "../inventory/inventory.helpers";

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
  const amountPaid = payload.amountPaid;
  const change = amountPaid - total;
  const remainingDebt = Math.max(0, total - amountPaid);
  const hasDebt = remainingDebt > 0;
  const customerId = payload.customerId ?? null;
  const now = new Date().toISOString();

  const txRef = db.collection(COLLECTIONS.TRANSACTIONS(ownerId, clubId)).doc();
  const debtRef = hasDebt ? db.collection(COLLECTIONS.DEBTS(ownerId, clubId)).doc() : null;

  const itemLabel = payload.items.length === 1
    ? payload.items[0]!.productName
    : `${payload.items.length} produk`;

  // Pre-load recipes for ingredient deduction
  const recipeMap = await loadRecipesForItems(ownerId, clubId, payload.items);
  const ingredientDeductions = buildIngredientDeductions(payload.items, recipeMap);

  await db.runTransaction(async (tx) => {
    // Owner POS deducts from the owner's warehouse, not the club's stock
    const invSnaps = await readInventorySnaps(
      tx,
      COLLECTIONS.OWNER_INVENTORY_ITEMS(ownerId),
      payload.items
    );
    const ingSnaps = ingredientDeductions.length > 0
      ? await readIngredientSnaps(tx, ownerId, clubId, ingredientDeductions)
      : [];

    tx.set(txRef, {
      id: txRef.id,
      ownerId,
      clubId,
      operatorId: null,
      deviceId: null,
      shiftId: null,
      customerId,
      membershipId: null,
      items: payload.items,
      subtotal,
      discount,
      total,
      paymentMethod: payload.paymentMethod,
      amountPaid,
      change,
      debtId: debtRef?.id ?? null,
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

    if (amountPaid > 0) {
      writeJournalEntry(tx, {
        ownerId, clubId,
        entryType: "sale",
        amount: amountPaid,
        debitAccount: ACCOUNT_CODES.CASH as AccountCode,
        creditAccount: ACCOUNT_CODES.SALES_REVENUE as AccountCode,
        description: `Owner sale — ${itemLabel}${payload.notes ? ` (${payload.notes})` : ""}`,
        requestId: payload.requestId,
        operationId,
        referenceId: txRef.id,
        referenceType: "transaction",
        operatorId: request.auth!.uid,
      });
    }

    if (hasDebt) {
      writeJournalEntry(tx, {
        ownerId, clubId,
        entryType: "sale",
        amount: remainingDebt,
        debitAccount: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE as AccountCode,
        creditAccount: ACCOUNT_CODES.SALES_REVENUE as AccountCode,
        description: `Piutang penjualan — ${itemLabel} untuk ${customerId}`,
        requestId: payload.requestId,
        operationId: `${operationId}_ar`,
        referenceId: txRef.id,
        referenceType: "transaction",
        operatorId: request.auth!.uid,
      });

      tx.set(debtRef!, {
        id: debtRef!.id,
        ownerId, clubId, customerId,
        source: "pos",
        referenceId: txRef.id,
        referenceLabel: itemLabel,
        totalAmount: total,
        paidAmount: amountPaid,
        remainingAmount: remainingDebt,
        status: amountPaid > 0 ? "partial" : "unpaid",
        payments: amountPaid > 0
          ? [{ amount: amountPaid, paymentMethod: payload.paymentMethod, notes: null, paidAt: now }]
          : [],
        createdAt: now,
        updatedAt: now,
      });
    }

    writeInventoryMovements(tx, {
      movementsPath: COLLECTIONS.OWNER_INVENTORY_MOVEMENTS(ownerId),
      ownerId, clubId,
      items: payload.items,
      invSnaps,
      transactionId: txRef.id,
      baseOperationId: operationId,
      operatorId: request.auth!.uid,
      requestId: payload.requestId,
      now,
      movementType: "sale",
    });

    if (ingredientDeductions.length > 0) {
      writeIngredientDeductions(tx, {
        ownerId, clubId,
        ingredients: ingredientDeductions,
        ingSnaps,
        transactionId: txRef.id,
        baseOperationId: operationId,
        operatorId: request.auth!.uid,
        requestId: payload.requestId,
        now,
        movementType: "sale",
      });
    }

    await markOperationComplete(tx, operationId, idempotencyPath, {
      transactionId: txRef.id,
      debtId: debtRef?.id ?? null,
    });
  });

  return { transactionId: txRef.id, total, change, debtId: debtRef?.id ?? null, remainingDebt };
});
