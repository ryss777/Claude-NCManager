import { db } from "../utils/admin";
import { COLLECTIONS } from "@nc-manager/shared-constants";
import type { RecipeIngredient } from "@nc-manager/validation";

export interface SaleItemRef {
  productId: string;
  productName: string;
  quantity: number;
}

export interface IngredientDeductionRef {
  inventoryItemId: string;
  inventoryItemName: string;
  quantity: number;
  unit: string;
}

/**
 * Pre-reads inventory item snapshots inside a transaction.
 * Must be called BEFORE any writes in the transaction body.
 *
 * @param itemsPath - Firestore collection path (e.g. OWNER_INVENTORY_ITEMS or INVENTORY_ITEMS)
 */
export async function readInventorySnaps(
  tx: FirebaseFirestore.Transaction,
  itemsPath: string,
  items: SaleItemRef[]
): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  return Promise.all(
    items.map((item) =>
      tx.get(db.collection(itemsPath).doc(item.productId))
    )
  );
}

// ── Recipe helpers ────────────────────────────────────────────────────────────

/**
 * Queries recipes linked to each sold product (outside a Firestore transaction).
 * Returns a map: productId → ingredient list.
 */
export async function loadRecipesForItems(
  ownerId: string,
  clubId: string,
  items: SaleItemRef[]
): Promise<Map<string, RecipeIngredient[]>> {
  const uniqueIds = [...new Set(items.map((i) => i.productId))];
  const snaps = await Promise.all(
    uniqueIds.map((productId) =>
      db
        .collection(COLLECTIONS.RECIPES(ownerId, clubId))
        .where("linkedProductId", "==", productId)
        .where("isActive", "==", true)
        .limit(1)
        .get()
    )
  );

  const recipeMap = new Map<string, RecipeIngredient[]>();
  snaps.forEach((snap, idx) => {
    if (!snap.empty) {
      recipeMap.set(uniqueIds[idx]!, snap.docs[0]!.data()["ingredients"] as RecipeIngredient[]);
    }
  });
  return recipeMap;
}

/**
 * Builds a deduplicated list of ingredient deductions from sold items + recipe map.
 * Multiplies recipe quantities by units sold.
 */
export function buildIngredientDeductions(
  items: SaleItemRef[],
  recipeMap: Map<string, RecipeIngredient[]>
): IngredientDeductionRef[] {
  const map = new Map<string, IngredientDeductionRef>();
  for (const item of items) {
    const ings = recipeMap.get(item.productId);
    if (!ings) continue;
    for (const ing of ings) {
      const qty = ing.quantity * item.quantity;
      const existing = map.get(ing.inventoryItemId);
      if (existing) {
        existing.quantity += qty;
      } else {
        map.set(ing.inventoryItemId, {
          inventoryItemId: ing.inventoryItemId,
          inventoryItemName: ing.inventoryItemName,
          quantity: qty,
          unit: ing.unit,
        });
      }
    }
  }
  return [...map.values()];
}

/**
 * Pre-reads ingredient snapshots inside a transaction (before any writes).
 */
export async function readIngredientSnaps(
  tx: FirebaseFirestore.Transaction,
  ownerId: string,
  clubId: string,
  ingredients: IngredientDeductionRef[]
): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  return Promise.all(
    ingredients.map((ing) =>
      tx.get(db.collection(COLLECTIONS.INVENTORY_ITEMS(ownerId, clubId)).doc(ing.inventoryItemId))
    )
  );
}

/**
 * Writes ingredient movement records and adjusts stock (inside a transaction).
 * Allows stock to go negative (warn, never block a sale).
 */
export function writeIngredientDeductions(
  tx: FirebaseFirestore.Transaction,
  params: {
    ownerId: string;
    clubId: string;
    ingredients: IngredientDeductionRef[];
    ingSnaps: FirebaseFirestore.DocumentSnapshot[];
    transactionId: string;
    baseOperationId: string;
    operatorId: string;
    requestId: string;
    now: string;
    movementType: "sale" | "reversal";
  }
): void {
  const {
    ownerId, clubId, ingredients, ingSnaps,
    transactionId, baseOperationId, operatorId, requestId, now, movementType,
  } = params;
  const isReturn = movementType === "reversal";

  for (let i = 0; i < ingredients.length; i++) {
    const snap = ingSnaps[i];
    if (!snap || !snap.exists) continue;

    const ing = ingredients[i]!;
    const currentStock = snap.data()!["currentStock"] as number;
    const stockAfter = isReturn ? currentStock + ing.quantity : currentStock - ing.quantity;

    const movRef = db.collection(COLLECTIONS.INVENTORY_MOVEMENTS(ownerId, clubId)).doc();
    tx.set(movRef, {
      id: movRef.id,
      ownerId,
      clubId,
      inventoryItemId: ing.inventoryItemId,
      itemName: ing.inventoryItemName,
      movementType,
      quantity: ing.quantity,
      stockBefore: currentStock,
      stockAfter,
      unitCost: 0,
      totalCost: 0,
      referenceId: transactionId,
      referenceType: "transaction",
      operatorId,
      notes: `Auto dari resep — ${movementType === "reversal" ? "dikembalikan" : "dipakai"}`,
      requestId,
      operationId: `${baseOperationId}_ing_${i}`,
      createdAt: now,
    });

    tx.update(snap.ref, { currentStock: stockAfter, updatedAt: now });
  }
}

/**
 * Writes inventory movement records and updates currentStock for each item.
 * Uses pre-read snapshots (from readInventorySnaps) — no reads performed here.
 *
 * @param params.movementsPath - Firestore collection path for movement records
 *   (e.g. OWNER_INVENTORY_MOVEMENTS(ownerId) or INVENTORY_MOVEMENTS(ownerId, clubId))
 */
export function writeInventoryMovements(
  tx: FirebaseFirestore.Transaction,
  params: {
    movementsPath: string;
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
    movementsPath, ownerId, clubId, items, invSnaps,
    transactionId, baseOperationId, operatorId, requestId, now, movementType,
  } = params;

  const isReturn = movementType === "reversal";

  for (let i = 0; i < items.length; i++) {
    const snap = invSnaps[i];
    if (!snap || !snap.exists) continue;

    const item = items[i]!;
    const currentStock = snap.data()!["currentStock"] as number;
    const stockAfter = isReturn ? currentStock + item.quantity : currentStock - item.quantity;

    const movementRef = db.collection(movementsPath).doc();

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
