import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import {
  createInventoryMovementSchema,
  createInventoryItemSchema,
  createIngredientSchema,
  adjustInventoryStockSchema,
  addFromCatalogSchema,
  removeInventoryItemSchema,
} from "@nc-manager/validation";
import { COLLECTIONS } from "@nc-manager/shared-constants";

// ── inventory_createItem ──────────────────────────────────────────────────────

export const inventory_createItem = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(createInventoryItemSchema, request.data);
  const { ownerId } = payload;

  const itemRef = db.collection(COLLECTIONS.OWNER_INVENTORY_ITEMS(ownerId)).doc();
  const now = new Date().toISOString();

  await itemRef.set({
    id: itemRef.id,
    ownerId,
    name: payload.name,
    unit: payload.unit,
    category: payload.category ?? null,
    prices: payload.prices,
    currentStock: 0,
    minimumStock: payload.minimumStock,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return { inventoryItemId: itemRef.id };
});

// ── inventory_createIngredient ────────────────────────────────────────────────

export const inventory_createIngredient = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(createIngredientSchema, request.data);
  const { ownerId, clubId } = payload;

  const itemRef = db.collection(COLLECTIONS.INVENTORY_ITEMS(ownerId, clubId)).doc();
  const now = new Date().toISOString();

  await itemRef.set({
    id: itemRef.id,
    ownerId,
    clubId,
    name: payload.name,
    unit: payload.unit,
    category: payload.category ?? null,
    prices: null,
    itemType: "ingredient",
    currentStock: 0,
    minimumStock: payload.minimumStock,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return { inventoryItemId: itemRef.id };
});

// ── inventory_addFromCatalog ──────────────────────────────────────────────────

export const inventory_addFromCatalog = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(addFromCatalogSchema, request.data);
  const { ownerId, productCatalogId, unit, minimumStock } = payload;

  const catalogSnap = await db.collection(COLLECTIONS.PRODUCT_CATALOG).doc(productCatalogId).get();
  if (!catalogSnap.exists) throw new HttpsError("not-found", "Produk tidak ditemukan di katalog");
  const catalog = catalogSnap.data()!;
  if (!catalog["isActive"]) throw new HttpsError("failed-precondition", "Produk tidak aktif");

  const existingSnap = await db
    .collection(COLLECTIONS.OWNER_INVENTORY_ITEMS(ownerId))
    .where("productCatalogId", "==", productCatalogId)
    .limit(1)
    .get();

  const now = new Date().toISOString();

  if (!existingSnap.empty) {
    const existingDoc = existingSnap.docs[0]!;
    if (existingDoc.data()["isActive"] !== false) {
      throw new HttpsError("already-exists", "Produk sudah ada di inventaris");
    }
    // Reactivate soft-deleted item
    await existingDoc.ref.update({ isActive: true, unit, minimumStock, updatedAt: now });
    return { inventoryItemId: existingDoc.id };
  }

  const itemRef = db.collection(COLLECTIONS.OWNER_INVENTORY_ITEMS(ownerId)).doc();

  await itemRef.set({
    id: itemRef.id,
    ownerId,
    productCatalogId,
    name: catalog["name"] as string,
    category: catalog["category"] as string,
    prices: catalog["prices"],
    unit,
    currentStock: 0,
    minimumStock,
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

  const payload = validatePayload(adjustInventoryStockSchema, request.data);
  const { ownerId, operationId, inventoryItemId, quantity, unitCost } = payload;

  const idempotencyPath = `owners/${ownerId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const itemRef = db.collection(COLLECTIONS.OWNER_INVENTORY_ITEMS(ownerId)).doc(inventoryItemId);
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
  const movementRef = db.collection(COLLECTIONS.OWNER_INVENTORY_MOVEMENTS(ownerId)).doc();

  await db.runTransaction(async (tx) => {
    tx.create(movementRef, {
      id: movementRef.id,
      ownerId,
      clubId: null,
      inventoryItemId,
      itemName: item["name"] as string,
      movementType: "adjustment",
      quantity: Math.abs(adjustmentDelta),
      stockBefore: currentStock,
      stockAfter,
      unitCost,
      totalCost: Math.abs(adjustmentDelta) * unitCost,
      referenceId: null,
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

// ── inventory_removeItem ──────────────────────────────────────────────────────

export const inventory_removeItem = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(removeInventoryItemSchema, request.data);
  const { ownerId, clubId, inventoryItemId, force } = payload;

  const itemRef = db.collection(COLLECTIONS.INVENTORY_ITEMS(ownerId, clubId)).doc(inventoryItemId);
  const snap = await itemRef.get();
  if (!snap.exists) throw new HttpsError("not-found", "Item tidak ditemukan");

  const currentStock = (snap.data()!["currentStock"] as number) ?? 0;
  if (currentStock > 0 && !force) {
    throw new HttpsError(
      "failed-precondition",
      `Stok masih ${currentStock}. Gunakan force:true untuk tetap menghapus.`
    );
  }

  await itemRef.update({ isActive: false, updatedAt: new Date().toISOString() });

  return { removed: true };
});
