import { db } from "../utils/admin";
import { COLLECTIONS } from "@nc-manager/shared-constants";

export interface SaleItemRef {
  productId: string;
  productName: string;
  quantity: number;
}

/**
 * Pre-reads inventory item snapshots inside a transaction.
 * Must be called BEFORE any writes in the transaction body.
 */
export async function readInventorySnaps(
  tx: FirebaseFirestore.Transaction,
  ownerId: string,
  clubId: string,
  items: SaleItemRef[]
): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  return Promise.all(
    items.map((item) =>
      tx.get(db.collection(COLLECTIONS.INVENTORY_ITEMS(ownerId, clubId)).doc(item.productId))
    )
  );
}

/**
 * Writes inventory movement records and updates currentStock for each item.
 * Uses pre-read snapshots (from readInventorySnaps) — no reads performed here.
 */
export function writeInventoryMovements(
  tx: FirebaseFirestore.Transaction,
  params: {
    ownerId: string;
    clubId: string;
    items: SaleItemRef[];
    invSnaps: FirebaseFirestore.DocumentSnapshot[];
    transactionId: string;
    baseOperationId: string;
    operatorId: string;
    requestId: string;
    now: string;
    movementType: "sale" | "reversal";
  }
): void {
  const {
    ownerId, clubId, items, invSnaps,
    transactionId, baseOperationId, operatorId, requestId, now, movementType,
  } = params;

  const isReturn = movementType === "reversal";

  for (let i = 0; i < items.length; i++) {
    const snap = invSnaps[i];
    if (!snap || !snap.exists) continue;

    const item = items[i]!;
    const currentStock = snap.data()!["currentStock"] as number;
    const stockAfter = isReturn ? currentStock + item.quantity : currentStock - item.quantity;

    const movementRef = db.collection(COLLECTIONS.INVENTORY_MOVEMENTS(ownerId, clubId)).doc();

    tx.set(movementRef, {
      id: movementRef.id,
      ownerId,
      clubId,
      inventoryItemId: item.productId,
      itemName: item.productName,
      movementType,
      quantity: item.quantity,
      stockBefore: currentStock,
      stockAfter,
      unitCost: 0,
      totalCost: 0,
      referenceId: transactionId,
      referenceType: "transaction",
      operatorId,
      notes: null,
      requestId,
      operationId: `${baseOperationId}_inv_${i}`,
      createdAt: now,
    });

    tx.update(snap.ref, { currentStock: stockAfter, updatedAt: now });
  }
}
