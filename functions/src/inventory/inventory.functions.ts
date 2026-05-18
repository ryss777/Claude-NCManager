import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import {
  createInventoryMovementSchema,
  createInventoryItemSchema,
} from "@nc-manager/validation";
import { COLLECTIONS } from "@nc-manager/shared-constants";

// ── inventory_createItem ──────────────────────────────────────────────────────

export const inventory_createItem = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(createInventoryItemSchema, request.data);
  const { ownerId, clubId } = payload;

  const itemRef = db.collection(COLLECTIONS.INVENTORY_ITEMS(ownerId, clubId)).doc();
  const now = new Date().toISOString();

  await itemRef.set({
    id: itemRef.id,
    ownerId,
    clubId,
    name: payload.name,
    sku: payload.sku,
    unit: payload.unit,
    currentStock: 0,
    minimumStock: payload.minimumStock,
    costPerUnit: payload.costPerUnit,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return { inventoryItemId: itemRef.id };
});

// ── inventory_createMovement ──────────────────────────────────────────────────

/**
 * Atomic movement: reads current stock, writes movement document,
 * updates currentStock — all in one Firestore transaction.
 * Restock/opening_stock add; sale/waste/transfer_out subtract.
 */
export const inventory_createMovement = onCall(async (request) => {
  requireRole(request, "operator");

  const payload = validatePayload(createInventoryMovementSchema, request.data);
  const { ownerId, clubId, operationId, inventoryItemId, movementType, quantity, unitCost } =
    payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const itemRef = db.collection(COLLECTIONS.INVENTORY_ITEMS(ownerId, clubId)).doc(inventoryItemId);

  const itemSnap = await itemRef.get();
  if (!itemSnap.exists) {
    throw new HttpsError("not-found", "Inventory item not found");
  }

  const item = itemSnap.data()!;
  const currentStock = item["currentStock"] as number;

  // Determine direction: additions vs subtractions
  const isAddition = ["restock", "transfer_in", "opening_stock", "reversal"].includes(movementType);
  const stockDelta = isAddition ? quantity : -quantity;
  const stockAfter = currentStock + stockDelta;

  if (stockAfter < 0) {
    throw new HttpsError(
      "failed-precondition",
      `Insufficient stock — current: ${currentStock}, requested: ${quantity}`
    );
  }

  const now = new Date().toISOString();
  const movementRef = db
    .collection(COLLECTIONS.INVENTORY_MOVEMENTS(ownerId, clubId))
    .doc();

  await db.runTransaction(async (tx) => {
    // Write immutable movement record
    tx.create(movementRef, {
      id: movementRef.id,
      ownerId,
      clubId,
      inventoryItemId,
      itemName: item["name"] as string,
      movementType,
      quantity,
      stockBefore: currentStock,
      stockAfter,
      unitCost,
      totalCost: quantity * unitCost,
      referenceId: payload.referenceId ?? null,
      referenceType: payload.referenceType ?? null,
      operatorId: request.auth!.uid,
      notes: payload.notes ?? null,
      requestId: payload.requestId,
      operationId,
      createdAt: now,
    });

    // Update current stock on the item document
    tx.update(itemRef, {
      currentStock: stockAfter,
      updatedAt: now,
    });

    await markOperationComplete(tx, operationId, idempotencyPath, {
      movementId: movementRef.id,
      stockAfter,
    });
  });

  return {
    movementId: movementRef.id,
    stockBefore: currentStock,
    stockAfter,
  };
});

// ── inventory_adjustStock ─────────────────────────────────────────────────────

/**
 * Owner-only manual stock adjustment (e.g., after physical count).
 * Always creates a movement of type "adjustment".
 */
export const inventory_adjustStock = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(createInventoryMovementSchema, request.data);
  const { ownerId, clubId, operationId, inventoryItemId, quantity, unitCost } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const itemRef = db.collection(COLLECTIONS.INVENTORY_ITEMS(ownerId, clubId)).doc(inventoryItemId);
  const itemSnap = await itemRef.get();

  if (!itemSnap.exists) {
    throw new HttpsError("not-found", "Inventory item not found");
  }

  const item = itemSnap.data()!;
  const currentStock = item["currentStock"] as number;
  // For adjustment: quantity IS the new absolute stock level
  const stockAfter = quantity;
  const adjustmentDelta = stockAfter - currentStock;

  const now = new Date().toISOString();
  const movementRef = db.collection(COLLECTIONS.INVENTORY_MOVEMENTS(ownerId, clubId)).doc();

  await db.runTransaction(async (tx) => {
    tx.create(movementRef, {
      id: movementRef.id,
      ownerId,
      clubId,
      inventoryItemId,
      itemName: item["name"] as string,
      movementType: "adjustment",
      quantity: Math.abs(adjustmentDelta),
      stockBefore: currentStock,
      stockAfter,
      unitCost,
      totalCost: Math.abs(adjustmentDelta) * unitCost,
      referenceId: payload.referenceId ?? null,
      referenceType: "manual",
      operatorId: request.auth!.uid,
      notes: payload.notes ?? null,
      requestId: payload.requestId,
      operationId,
      createdAt: now,
    });

    tx.update(itemRef, {
      currentStock: stockAfter,
      updatedAt: now,
    });

    await markOperationComplete(tx, operationId, idempotencyPath, {
      movementId: movementRef.id,
      stockAfter,
    });
  });

  return { movementId: movementRef.id, stockBefore: currentStock, stockAfter };
});
