import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import { ownerSaleSchema, exchangeItemsSchema } from "@nc-manager/validation";
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

// ── pos_exchangeItems ──────────────────────────────────────────────────────────
//
// Partial return + optional replacement for an owner-created sale.
//
// returnItems  — products given back (stock restored to owner warehouse)
// newItems     — replacement products taken out (stock deducted from owner warehouse)
// diffAmount   — newTotal - returnTotal
//     positive  → customer pays extra
//     negative  → owner refunds
//     zero      → straight swap

export const pos_exchangeItems = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(exchangeItemsSchema, request.data);
  const { ownerId, clubId, operationId, transactionId } = payload;
  const returnItems = payload.returnItems;
  const newItems = payload.newItems ?? [];

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  // ── Load + validate original transaction (outside Firestore tx so reads are cheaper) ──
  const txRef = db.collection(COLLECTIONS.TRANSACTIONS(ownerId, clubId)).doc(transactionId);
  const txSnap = await txRef.get();

  if (!txSnap.exists) {
    throw new HttpsError("not-found", "Transaksi tidak ditemukan");
  }

  const txData = txSnap.data()!;

  if (txData["status"] === "reversed") {
    throw new HttpsError("failed-precondition", "Transaksi sudah dibatalkan, tidak dapat ditukar");
  }
  if (txData["status"] !== "completed") {
    throw new HttpsError("failed-precondition", "Hanya transaksi 'completed' yang dapat ditukar");
  }
  if (txData["createdBy"] !== "owner") {
    throw new HttpsError("failed-precondition", "Fitur tukar hanya tersedia untuk transaksi kasir owner");
  }

  // Validate returnItems don't exceed original quantities
  const origItems = txData["items"] as { productId: string; quantity: number }[];
  const origQtyMap = new Map(origItems.map((i) => [i.productId, i.quantity]));

  for (const ret of returnItems) {
    const origQty = origQtyMap.get(ret.productId);
    if (origQty === undefined) {
      throw new HttpsError(
        "invalid-argument",
        `Produk ${ret.productName} tidak ada dalam transaksi asal`
      );
    }
    if (ret.quantity > origQty) {
      throw new HttpsError(
        "invalid-argument",
        `Jumlah retur ${ret.productName} (${ret.quantity}) melebihi pembelian asal (${origQty})`
      );
    }
  }

  const returnTotal = returnItems.reduce((s, i) => s + i.subtotal, 0);
  const newTotal    = newItems.reduce((s, i) => s + i.subtotal, 0);
  const diffAmount  = newTotal - returnTotal;
  const now         = new Date().toISOString();
  const exchangeRef = db.collection(COLLECTIONS.TRANSACTIONS(ownerId, clubId)).doc();

  await db.runTransaction(async (tx) => {
    // ── Read phase — ALL reads before any writes ──────────────────────────────

    // Return items: inventory snaps to add stock back
    const returnInvSnaps = await readInventorySnaps(
      tx,
      COLLECTIONS.OWNER_INVENTORY_ITEMS(ownerId),
      returnItems.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity }))
    );

    // New items: inventory snaps to deduct stock
    const newInvSnaps = newItems.length > 0
      ? await readInventorySnaps(
          tx,
          COLLECTIONS.OWNER_INVENTORY_ITEMS(ownerId),
          newItems.map((i) => ({ productId: i.productId, productName: i.productName, quantity: i.quantity }))
        )
      : [];

    // ── Write phase ───────────────────────────────────────────────────────────

    // 1. Create exchange record
    tx.set(exchangeRef, {
      id: exchangeRef.id,
      type: "exchange",
      ownerId,
      clubId,
      originalTransactionId: transactionId,
      customerId: txData["customerId"] ?? null,
      returnItems,
      newItems,
      returnTotal,
      newTotal,
      diffAmount,
      notes: payload.notes ?? null,
      status: "completed",
      operatorId: null,
      deviceId: null,
      shiftId: null,
      createdBy: "owner",
      requestId: payload.requestId,
      operationId,
      createdAt: now,
      updatedAt: now,
      completedAt: now,
    });

    // 2. Flag original transaction as exchanged
    tx.update(txRef, {
      hasExchange: true,
      lastExchangeId: exchangeRef.id,
      updatedAt: now,
    });

    // 3. Restore return items to owner warehouse (reversal → stock goes up)
    writeInventoryMovements(tx, {
      movementsPath: COLLECTIONS.OWNER_INVENTORY_MOVEMENTS(ownerId),
      ownerId,
      clubId,
      items: returnItems.map(({ productId, productName, quantity }) => ({ productId, productName, quantity })),
      invSnaps: returnInvSnaps,
      transactionId: exchangeRef.id,
      baseOperationId: `${operationId}_ret`,
      operatorId: request.auth!.uid,
      requestId: payload.requestId,
      now,
      movementType: "reversal",
    });

    // 4. Deduct new replacement items from owner warehouse (sale → stock goes down)
    if (newItems.length > 0) {
      writeInventoryMovements(tx, {
        movementsPath: COLLECTIONS.OWNER_INVENTORY_MOVEMENTS(ownerId),
        ownerId,
        clubId,
        items: newItems.map(({ productId, productName, quantity }) => ({ productId, productName, quantity })),
        invSnaps: newInvSnaps,
        transactionId: exchangeRef.id,
        baseOperationId: `${operationId}_new`,
        operatorId: request.auth!.uid,
        requestId: payload.requestId,
        now,
        movementType: "sale",
      });
    }

    // 5. Journal entry for net price difference
    if (diffAmount !== 0) {
      writeJournalEntry(tx, {
        ownerId,
        clubId,
        entryType: diffAmount > 0 ? "sale" : "reversal",
        amount: Math.abs(diffAmount),
        debitAccount: (diffAmount > 0
          ? ACCOUNT_CODES.CASH           // customer pays extra  → debit cash
          : ACCOUNT_CODES.SALES_REVENUE  // owner refunds        → debit revenue (reducing it)
        ) as AccountCode,
        creditAccount: (diffAmount > 0
          ? ACCOUNT_CODES.SALES_REVENUE  // customer pays extra  → credit revenue
          : ACCOUNT_CODES.CASH           // owner refunds        → credit cash (paying out)
        ) as AccountCode,
        description: `Tukar produk — transaksi ${transactionId}${payload.notes ? ` (${payload.notes})` : ""}`,
        requestId: payload.requestId,
        operationId: `${operationId}_jnl`,
        referenceId: exchangeRef.id,
        referenceType: "transaction",
        operatorId: request.auth!.uid,
      });
    }

    await markOperationComplete(tx, operationId, idempotencyPath, {
      exchangeId: exchangeRef.id,
    });
  });

  return { exchangeId: exchangeRef.id, returnTotal, newTotal, diffAmount };
});
