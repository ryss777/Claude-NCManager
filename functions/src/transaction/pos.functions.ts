import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import {
  createTransactionSchema,
  reverseTransactionSchema,
  startMakingSchema,
  completeTransactionSchema,
} from "@nc-manager/validation";
import { COLLECTIONS, ACCOUNT_CODES } from "@nc-manager/shared-constants";
import type { AccountCode, PaymentMethod } from "@nc-manager/shared-types";
import { writeJournalEntry } from "../finance/finance.helpers";
import {
  readInventorySnaps,
  writeInventoryMovements,
  loadRecipesForItems,
  buildIngredientDeductions,
  readIngredientSnaps,
  writeIngredientDeductions,
  type SaleItemRef,
} from "../inventory/inventory.helpers";

// ── Helpers ───────────────────────────────────────────────────────────────────

function saleAccounts(paymentMethod: PaymentMethod): {
  debit: AccountCode;
  credit: AccountCode;
} {
  if (paymentMethod === "member_balance") {
    return {
      debit: ACCOUNT_CODES.MEMBER_BALANCE as AccountCode,
      credit: ACCOUNT_CODES.SALES_REVENUE as AccountCode,
    };
  }
  // cash and transfer both debit CASH
  return {
    debit: ACCOUNT_CODES.CASH as AccountCode,
    credit: ACCOUNT_CODES.SALES_REVENUE as AccountCode,
  };
}

function reversalAccounts(paymentMethod: PaymentMethod): {
  debit: AccountCode;
  credit: AccountCode;
} {
  const sale = saleAccounts(paymentMethod);
  return { debit: sale.credit, credit: sale.debit };
}

// ── pos_createTransaction ─────────────────────────────────────────────────────

export const pos_createTransaction = onCall(async (request) => {
  requireRole(request, "operator");

  const payload = validatePayload(createTransactionSchema, request.data);
  const { ownerId, clubId, operationId } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const transactionRef = db.collection(COLLECTIONS.TRANSACTIONS(ownerId, clubId)).doc();

  const subtotal = payload.items.reduce((sum, item) => sum + item.subtotal, 0);
  const discount = payload.discount ?? 0;
  const total = subtotal - discount;
  const change = payload.amountPaid - total;

  const now = new Date().toISOString();
  const auth = request.auth!;

  const txData = {
    id: transactionRef.id,
    ownerId,
    clubId,
    operatorId: auth.uid,
    deviceId: (auth.token as Record<string, unknown>)["deviceId"] as string,
    shiftId: payload.shiftId,
    customerId: payload.customerId ?? null,
    membershipId: payload.membershipId ?? null,
    items: payload.items,
    subtotal,
    discount,
    total,
    paymentMethod: payload.paymentMethod,
    amountPaid: payload.amountPaid,
    change,
    status: "pending",
    requestId: payload.requestId,
    operationId,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    reversalReason: null,
    reversedTransactionId: null,
    createdBy: "operator",
  };

  await db.runTransaction(async (tx) => {
    tx.set(transactionRef, txData);
    await markOperationComplete(tx, operationId, idempotencyPath, {
      transactionId: transactionRef.id,
    });
  });

  return { transactionId: transactionRef.id };
});

// ── pos_startMaking ───────────────────────────────────────────────────────────

export const pos_startMaking = onCall(async (request) => {
  requireRole(request, "operator");

  const { transactionId, operatorId } = validatePayload(startMakingSchema, request.data);
  const token = request.auth!.token as Record<string, unknown>;
  const ownerId = token["ownerId"] as string;
  const clubId = token["clubId"] as string;

  const txRef = db.collection(COLLECTIONS.TRANSACTIONS(ownerId, clubId)).doc(transactionId);
  const snap = await txRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Transaction not found");
  }

  const txData = snap.data()!;
  if ((txData["status"] as string) !== "pending") {
    throw new HttpsError("failed-precondition", `Cannot start making — status: ${txData["status"] as string}`);
  }

  await txRef.update({
    status: "making",
    operatorId,
    updatedAt: new Date().toISOString(),
  });

  return { transactionId, status: "making" };
});

// ── pos_completeTransaction ───────────────────────────────────────────────────

export const pos_completeTransaction = onCall(async (request) => {
  requireRole(request, "operator");

  const { transactionId, operatorId } = validatePayload(completeTransactionSchema, request.data);
  const token = request.auth!.token as Record<string, unknown>;
  const ownerId = token["ownerId"] as string;
  const clubId = token["clubId"] as string;

  const txRef = db.collection(COLLECTIONS.TRANSACTIONS(ownerId, clubId)).doc(transactionId);
  const snap = await txRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Transaction not found");
  }

  const txData = snap.data()!;
  const status = txData["status"] as string;

  if (status === "completed") {
    return { transactionId, status: "completed" }; // idempotent
  }
  if (status !== "making" && status !== "pending") {
    throw new HttpsError("failed-precondition", `Cannot complete — status: ${status}`);
  }

  const paymentMethod = txData["paymentMethod"] as PaymentMethod;
  const total = txData["total"] as number;
  const shiftId = txData["shiftId"] as string;
  const membershipId = txData["membershipId"] as string | null;
  const txItems = txData["items"] as SaleItemRef[];
  const now = new Date().toISOString();

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const operationId = `complete_${transactionId}`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  if (isDuplicate) return { transactionId, status: "completed" };

  const shiftRef = db.collection(COLLECTIONS.SHIFTS(ownerId, clubId)).doc(shiftId);
  const accounts = saleAccounts(paymentMethod);

  // Pre-load recipes (outside the Firestore transaction — reads only)
  const recipeMap = await loadRecipesForItems(ownerId, clubId, txItems);
  const ingredientDeductions = buildIngredientDeductions(txItems, recipeMap);

  await db.runTransaction(async (tx) => {
    // Pre-read inventory items before any writes (club stock for operator POS)
    const invSnaps = await readInventorySnaps(
      tx,
      COLLECTIONS.INVENTORY_ITEMS(ownerId, clubId),
      txItems
    );
    const ingSnaps = ingredientDeductions.length > 0
      ? await readIngredientSnaps(tx, ownerId, clubId, ingredientDeductions)
      : [];

    // 1. Update transaction status
    tx.update(txRef, {
      status: "completed",
      operatorId,
      completedAt: now,
      updatedAt: now,
    });

    // 2. Write finance journal entry
    writeJournalEntry(tx, {
      ownerId,
      clubId,
      entryType: "sale",
      amount: total,
      debitAccount: accounts.debit,
      creditAccount: accounts.credit,
      description: `Sale — transaction ${transactionId}`,
      requestId: txData["requestId"] as string,
      operationId,
      referenceId: transactionId,
      referenceType: "transaction",
      shiftId,
      operatorId,
    });

    // 3. Update shift totals
    tx.update(shiftRef, {
      totalTransactions: (await shiftRef.get()).data()!["totalTransactions"] as number + 1,
      totalRevenue: (await shiftRef.get()).data()!["totalRevenue"] as number + total,
    });

    // 4. Deduct membership visit (if applicable)
    if (membershipId) {
      const membershipRef = db
        .collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId))
        .doc(membershipId);
      const membershipSnap = await membershipRef.get();

      if (membershipSnap.exists) {
        const membership = membershipSnap.data()!;
        const visitRemaining = membership["visitRemaining"] as number;

        if (visitRemaining > 0) {
          const visitRef = db.collection(COLLECTIONS.MEMBERSHIP_VISITS(ownerId, clubId)).doc();
          tx.set(visitRef, {
            id: visitRef.id,
            ownerId,
            clubId,
            membershipId,
            customerId: txData["customerId"] as string,
            transactionId,
            visitsBefore: visitRemaining,
            visitsAfter: visitRemaining - 1,
            requestId: txData["requestId"] as string,
            operationId: `visit_${transactionId}`,
            createdAt: now,
          });

          tx.update(membershipRef, {
            visitUsed: membership["visitUsed"] as number + 1,
            visitRemaining: visitRemaining - 1,
            updatedAt: now,
          });
        }
      }
    }

    // 5. Deduct inventory stock for each sold item (club stock)
    writeInventoryMovements(tx, {
      movementsPath: COLLECTIONS.INVENTORY_MOVEMENTS(ownerId, clubId),
      ownerId,
      clubId,
      items: txItems,
      invSnaps,
      transactionId,
      baseOperationId: operationId,
      operatorId,
      requestId: txData["requestId"] as string,
      now,
      movementType: "sale",
    });

    // 6. Deduct ingredient stock from linked recipes
    if (ingredientDeductions.length > 0) {
      writeIngredientDeductions(tx, {
        ownerId,
        clubId,
        ingredients: ingredientDeductions,
        ingSnaps,
        transactionId,
        baseOperationId: operationId,
        operatorId,
        requestId: txData["requestId"] as string,
        now,
        movementType: "sale",
      });
    }

    await markOperationComplete(tx, operationId, idempotencyPath, { transactionId });
  });

  return { transactionId, status: "completed" };
});

// ── pos_reverseTransaction ────────────────────────────────────────────────────

export const pos_reverseTransaction = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(reverseTransactionSchema, request.data);
  const { ownerId, clubId, operationId, transactionId, reason } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const txRef = db.collection(COLLECTIONS.TRANSACTIONS(ownerId, clubId)).doc(transactionId);
  const snap = await txRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Transaction not found");
  }

  const txData = snap.data()!;
  const status = txData["status"] as string;

  if (status === "reversed") {
    return { transactionId, status: "reversed" }; // idempotent
  }
  if (status !== "completed") {
    throw new HttpsError("failed-precondition", `Can only reverse completed transactions — status: ${status}`);
  }

  const paymentMethod = txData["paymentMethod"] as PaymentMethod;
  const total = txData["total"] as number;
  const shiftId = txData["shiftId"] as string;
  const membershipId = txData["membershipId"] as string | null;
  const txItems = txData["items"] as SaleItemRef[];
  const now = new Date().toISOString();
  const reversalAccs = reversalAccounts(paymentMethod);
  const shiftRef = db.collection(COLLECTIONS.SHIFTS(ownerId, clubId)).doc(shiftId);

  // Pre-load recipes for ingredient restoration
  const recipeMap = await loadRecipesForItems(ownerId, clubId, txItems);
  const ingredientDeductions = buildIngredientDeductions(txItems, recipeMap);

  await db.runTransaction(async (tx) => {
    // Pre-read inventory items before any writes (club stock for reversal)
    const invSnaps = await readInventorySnaps(
      tx,
      COLLECTIONS.INVENTORY_ITEMS(ownerId, clubId),
      txItems
    );
    const ingSnaps = ingredientDeductions.length > 0
      ? await readIngredientSnaps(tx, ownerId, clubId, ingredientDeductions)
      : [];

    // 1. Mark original transaction as reversed
    tx.update(txRef, {
      status: "reversed",
      reversalReason: reason,
      updatedAt: now,
    });

    // 2. Write reversal journal entry
    writeJournalEntry(tx, {
      ownerId,
      clubId,
      entryType: "reversal",
      amount: total,
      debitAccount: reversalAccs.debit,
      creditAccount: reversalAccs.credit,
      description: `Reversal of transaction ${transactionId} — ${reason}`,
      requestId: payload.requestId,
      operationId,
      referenceId: transactionId,
      referenceType: "transaction",
      shiftId,
    });

    // 3. Reverse shift totals
    tx.update(shiftRef, {
      totalTransactions: (await shiftRef.get()).data()!["totalTransactions"] as number - 1,
      totalRevenue: (await shiftRef.get()).data()!["totalRevenue"] as number - total,
    });

    // 4. Restore membership visit (if applicable)
    if (membershipId) {
      const membershipRef = db
        .collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId))
        .doc(membershipId);
      const membershipSnap = await membershipRef.get();

      if (membershipSnap.exists) {
        const membership = membershipSnap.data()!;
        tx.update(membershipRef, {
          visitUsed: Math.max(0, (membership["visitUsed"] as number) - 1),
          visitRemaining: (membership["visitRemaining"] as number) + 1,
          updatedAt: now,
        });
      }
    }

    // 5. Restore inventory stock (return items to shelf — club stock)
    writeInventoryMovements(tx, {
      movementsPath: COLLECTIONS.INVENTORY_MOVEMENTS(ownerId, clubId),
      ownerId,
      clubId,
      items: txItems,
      invSnaps,
      transactionId,
      baseOperationId: operationId,
      operatorId: request.auth!.uid,
      requestId: payload.requestId,
      now,
      movementType: "reversal",
    });

    // 6. Restore ingredient stock from linked recipes
    if (ingredientDeductions.length > 0) {
      writeIngredientDeductions(tx, {
        ownerId,
        clubId,
        ingredients: ingredientDeductions,
        ingSnaps,
        transactionId,
        baseOperationId: operationId,
        operatorId: request.auth!.uid,
        requestId: payload.requestId,
        now,
        movementType: "reversal",
      });
    }

    await markOperationComplete(tx, operationId, idempotencyPath, { transactionId });
  });

  return { transactionId, status: "reversed" };
});
