import { onCall } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import { createReplenishmentSchema } from "@nc-manager/validation";
import { COLLECTIONS, ACCOUNT_CODES } from "@nc-manager/shared-constants";
import type { AccountCode } from "@nc-manager/shared-types";
import { writeJournalEntry } from "../finance/finance.helpers";

// ── replenishment_complete ────────────────────────────────────────────────────
//
// Owner transfers stock to a club. Atomically:
//   1. Creates a replenishment record
//   2. Writes a stock_purchase journal entry (debit COGS / credit CASH)
//   3. Creates an inventory movement of type "restock" per item
//   4. Increments currentStock on each inventory item

export const replenishment_complete = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(createReplenishmentSchema, request.data);
  const { ownerId, clubId, operationId, items, priceTier, notes } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const total = items.reduce((sum, item) => sum + item.subtotal, 0);
  const now = new Date().toISOString();
  const replenishmentRef = db.collection(COLLECTIONS.REPLENISHMENTS(ownerId, clubId)).doc();

  await db.runTransaction(async (tx) => {
    // Pre-read inventory items before any writes
    const invSnaps = await Promise.all(
      items.map((item) =>
        tx.get(db.collection(COLLECTIONS.INVENTORY_ITEMS(ownerId, clubId)).doc(item.productId))
      )
    );

    // 1. Create replenishment record
    tx.set(replenishmentRef, {
      id: replenishmentRef.id,
      ownerId,
      clubId,
      items,
      priceTier,
      total,
      notes: notes ?? null,
      status: "completed",
      requestId: payload.requestId,
      operationId,
      createdBy: request.auth!.uid,
      createdAt: now,
      completedAt: now,
    });

    // 2. Journal entry — debit COGS (cost of stock acquired), credit CASH
    writeJournalEntry(tx, {
      ownerId,
      clubId,
      entryType: "stock_purchase",
      amount: total,
      debitAccount: ACCOUNT_CODES.COGS as AccountCode,
      creditAccount: ACCOUNT_CODES.CASH as AccountCode,
      description: `Replenishment — ${items.length} item(s) at ${priceTier} tier`,
      requestId: payload.requestId,
      operationId,
      referenceId: replenishmentRef.id,
      referenceType: "replenishment",
      operatorId: request.auth!.uid,
    });

    // 3 & 4. Movement record + stock increment per item
    for (let i = 0; i < items.length; i++) {
      const snap = invSnaps[i];
      if (!snap || !snap.exists) continue;

      const item = items[i]!;
      const currentStock = snap.data()!["currentStock"] as number;
      const stockAfter = currentStock + item.quantity;

      const movementRef = db.collection(COLLECTIONS.INVENTORY_MOVEMENTS(ownerId, clubId)).doc();
      tx.set(movementRef, {
        id: movementRef.id,
        ownerId,
        clubId,
        inventoryItemId: item.productId,
        itemName: item.productName,
        movementType: "restock",
        quantity: item.quantity,
        stockBefore: currentStock,
        stockAfter,
        unitCost: item.unitPrice,
        totalCost: item.subtotal,
        referenceId: replenishmentRef.id,
        referenceType: "replenishment",
        operatorId: request.auth!.uid,
        notes: notes ?? null,
        requestId: payload.requestId,
        operationId: `${operationId}_inv_${i}`,
        createdAt: now,
      });

      tx.update(snap.ref, { currentStock: stockAfter, updatedAt: now });
    }

    await markOperationComplete(tx, operationId, idempotencyPath, {
      replenishmentId: replenishmentRef.id,
      totalCost: total,
    });
  });

  return { replenishmentId: replenishmentRef.id, totalCost: total };
});
