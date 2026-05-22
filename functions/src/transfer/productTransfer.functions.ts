import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import { createProductTransferSchema, acceptProductTransferSchema } from "@nc-manager/validation";
import { COLLECTIONS, ACCOUNT_CODES } from "@nc-manager/shared-constants";
import type { AccountCode } from "@nc-manager/shared-types";
import { writeJournalEntry } from "../finance/finance.helpers";

// ── productTransfer_create ────────────────────────────────────────────────────
//
// Transfers products FROM source club TO another club (same owner, atomic)
// or TO another owner (deduct source + create pending record for acceptance).
//
// paymentType:
//   "bayar"  — journal: debit ACCOUNTS_RECEIVABLE / credit SALES_REVENUE
//   "pinjam" — no journal when destinationType is "owner" (free loan, no cost)

export const productTransfer_create = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(createProductTransferSchema, request.data);
  const {
    ownerId, sourceClubId, operationId,
    destinationType, destinationClubId, destinationOwnerId,
    paymentType, priceTier, items, notes,
  } = payload;

  const idempotencyPath = `owners/${ownerId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  if (destinationType === "club" && !destinationClubId) {
    throw new HttpsError("invalid-argument", "destinationClubId required for club transfer");
  }
  if (destinationType === "owner" && !destinationOwnerId) {
    throw new HttpsError("invalid-argument", "destinationOwnerId required for owner transfer");
  }

  const total = items.reduce((sum, item) => sum + item.subtotal, 0);
  const now = new Date().toISOString();
  const transferRef = db.collection(COLLECTIONS.PRODUCT_TRANSFERS(ownerId)).doc();

  // For same-owner club transfer: pre-query destination items by productCatalogId
  const destItemMap = new Map<string, FirebaseFirestore.DocumentReference>();
  if (destinationType === "club" && destinationClubId) {
    const catalogIds = items
      .map((i) => i.productCatalogId)
      .filter((id): id is string => !!id);

    if (catalogIds.length > 0) {
      const destSnaps = await db
        .collection(COLLECTIONS.INVENTORY_ITEMS(ownerId, destinationClubId))
        .where("productCatalogId", "in", catalogIds.slice(0, 30))
        .get();
      for (const doc of destSnaps.docs) {
        const catalogId = doc.data()["productCatalogId"] as string;
        destItemMap.set(catalogId, doc.ref);
      }
    }
  }

  const isInternal = destinationType === "club";
  const status = isInternal ? "completed" : "pending_acceptance";

  // Cross-owner+pinjam = no cost, no journal entry
  const shouldWriteJournal = !(destinationType === "owner" && paymentType === "pinjam");

  await db.runTransaction(async (tx) => {
    // Pre-read owner warehouse items (source of all outgoing transfers)
    const sourceSnaps = await Promise.all(
      items.map((item) =>
        tx.get(db.collection(COLLECTIONS.OWNER_INVENTORY_ITEMS(ownerId)).doc(item.productId))
      )
    );

    // Pre-read destination items (same-owner club only)
    const destSnaps: Map<string, FirebaseFirestore.DocumentSnapshot> = new Map();
    if (isInternal) {
      for (const [catalogId, ref] of destItemMap.entries()) {
        destSnaps.set(catalogId, await tx.get(ref));
      }
    }

    // 1. Create transfer record
    tx.set(transferRef, {
      id: transferRef.id,
      ownerId,
      sourceClubId,
      destinationType,
      destinationOwnerId: destinationType === "owner" ? destinationOwnerId : ownerId,
      destinationClubId: destinationType === "club" ? destinationClubId : null,
      paymentType,
      priceTier,
      items,
      total,
      status,
      notes: notes ?? null,
      requestId: payload.requestId,
      operationId,
      createdBy: request.auth!.uid,
      createdAt: now,
      completedAt: isInternal ? now : null,
    });

    // 2. Journal entry (skip for cross-owner pinjam)
    if (shouldWriteJournal) {
      const debitAccount: AccountCode =
        paymentType === "bayar"
          ? (ACCOUNT_CODES.ACCOUNTS_RECEIVABLE as AccountCode)
          : (ACCOUNT_CODES.ACCOUNTS_RECEIVABLE as AccountCode);

      writeJournalEntry(tx, {
        ownerId,
        // Transfer originates from owner warehouse (no source club);
        // attribute to destination club if internal, otherwise use a placeholder
        clubId: (destinationClubId ?? sourceClubId ?? "") as string,
        entryType: "stock_transfer",
        amount: total,
        debitAccount,
        creditAccount: ACCOUNT_CODES.SALES_REVENUE as AccountCode,
        description: `Transfer produk — ${
          destinationType === "club"
            ? `ke club ${destinationClubId ?? ""}`
            : `ke owner ${destinationOwnerId ?? ""}`
        } (${paymentType})`,
        requestId: payload.requestId,
        operationId,
        referenceId: transferRef.id,
        referenceType: "replenishment",
        operatorId: request.auth!.uid,
      });
    }

    // 3. Deduct source inventory + write movements
    for (let i = 0; i < items.length; i++) {
      const snap = sourceSnaps[i];
      if (!snap || !snap.exists) continue;

      const item = items[i]!;
      const currentStock = snap.data()!["currentStock"] as number;
      const stockAfter = currentStock - item.quantity;

      const movRef = db.collection(COLLECTIONS.OWNER_INVENTORY_MOVEMENTS(ownerId)).doc();
      tx.set(movRef, {
        id: movRef.id,
        ownerId,
        clubId: null,
        inventoryItemId: item.productId,
        itemName: item.productName,
        movementType: "transfer_out",
        quantity: item.quantity,
        stockBefore: currentStock,
        stockAfter,
        unitCost: item.unitPrice,
        totalCost: item.subtotal,
        referenceId: transferRef.id,
        referenceType: "transfer",
        operatorId: request.auth!.uid,
        notes: notes ?? null,
        requestId: payload.requestId,
        operationId: `${operationId}_out_${i}`,
        createdAt: now,
      });
      tx.update(snap.ref, { currentStock: stockAfter, updatedAt: now });
    }

    // 4. Increment destination inventory (same-owner club only)
    if (isInternal) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]!;
        if (!item.productCatalogId) continue;

        const destSnap = destSnaps.get(item.productCatalogId);
        if (!destSnap || !destSnap.exists) continue;

        const currentStock = destSnap.data()!["currentStock"] as number;
        const stockAfter = currentStock + item.quantity;

        const movRef = db.collection(COLLECTIONS.INVENTORY_MOVEMENTS(ownerId, destinationClubId!)).doc();
        tx.set(movRef, {
          id: movRef.id,
          ownerId,
          clubId: destinationClubId,
          inventoryItemId: destSnap.id,
          itemName: item.productName,
          movementType: "transfer_in",
          quantity: item.quantity,
          stockBefore: currentStock,
          stockAfter,
          unitCost: item.unitPrice,
          totalCost: item.subtotal,
          referenceId: transferRef.id,
          referenceType: "transfer",
          operatorId: request.auth!.uid,
          notes: notes ?? null,
          requestId: payload.requestId,
          operationId: `${operationId}_in_${i}`,
          createdAt: now,
        });
        tx.update(destSnap.ref, { currentStock: stockAfter, updatedAt: now });
      }
    }

    // 5. Notification to destination owner (cross-owner only)
    if (destinationType === "owner" && destinationOwnerId) {
      const notifRef = db
        .collection(COLLECTIONS.OWNER_NOTIFICATIONS(destinationOwnerId))
        .doc(transferRef.id);
      tx.set(notifRef, {
        id: transferRef.id,
        type: "transfer_incoming",
        status: "pending",
        transferId: transferRef.id,
        sourceOwnerId: ownerId,
        sourceClubId,
        paymentType,
        priceTier,
        items,
        total,
        notes: notes ?? null,
        createdAt: now,
        read: false,
      });
    }

    await markOperationComplete(tx, operationId, idempotencyPath, {
      transferId: transferRef.id,
      status,
    });
  });

  return { transferId: transferRef.id, total, status };
});

// ── productTransfer_accept ────────────────────────────────────────────────────
//
// Destination owner confirms a pending cross-owner transfer.
// Increments stock in the specified destination club and marks transfer complete.
// No journal entry for pinjam transfers (free loan).

export const productTransfer_accept = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(acceptProductTransferSchema, request.data);
  const { ownerId, sourceOwnerId, transferId, destinationClubId, operationId } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${destinationClubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const transferRef = db
    .collection(COLLECTIONS.PRODUCT_TRANSFERS(sourceOwnerId))
    .doc(transferId);
  const transferSnap = await transferRef.get();

  if (!transferSnap.exists) {
    throw new HttpsError("not-found", "Transfer tidak ditemukan");
  }

  const transfer = transferSnap.data()!;

  if ((transfer["destinationOwnerId"] as string) !== ownerId) {
    throw new HttpsError("permission-denied", "Transfer ini bukan untuk Anda");
  }
  if ((transfer["status"] as string) !== "pending_acceptance") {
    throw new HttpsError("failed-precondition", "Transfer sudah diterima atau dibatalkan");
  }

  type TransferItem = {
    productId: string;
    productCatalogId: string | null;
    productName: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
  };

  const items = transfer["items"] as TransferItem[];
  const paymentType = transfer["paymentType"] as "bayar" | "pinjam";
  const total = transfer["total"] as number;
  const now = new Date().toISOString();

  // Pre-query destination items by productCatalogId
  const catalogIds = items
    .map((i) => i.productCatalogId)
    .filter((id): id is string => !!id);

  const destItemMap = new Map<string, FirebaseFirestore.DocumentReference>();
  if (catalogIds.length > 0) {
    const destSnaps = await db
      .collection(COLLECTIONS.INVENTORY_ITEMS(ownerId, destinationClubId))
      .where("productCatalogId", "in", catalogIds.slice(0, 30))
      .get();
    for (const doc of destSnaps.docs) {
      destItemMap.set(doc.data()["productCatalogId"] as string, doc.ref);
    }
  }

  await db.runTransaction(async (tx) => {
    // Pre-read destination items
    const destSnapsInTx = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    for (const [catalogId, ref] of destItemMap.entries()) {
      destSnapsInTx.set(catalogId, await tx.get(ref));
    }

    // 1. Increment destination stock + write movements
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (!item.productCatalogId) continue;

      const destSnap = destSnapsInTx.get(item.productCatalogId);
      if (!destSnap || !destSnap.exists) continue;

      const currentStock = destSnap.data()!["currentStock"] as number;
      const stockAfter = currentStock + item.quantity;

      const movRef = db
        .collection(COLLECTIONS.INVENTORY_MOVEMENTS(ownerId, destinationClubId))
        .doc();
      tx.set(movRef, {
        id: movRef.id,
        ownerId,
        clubId: destinationClubId,
        inventoryItemId: destSnap.id,
        itemName: item.productName,
        movementType: "transfer_in",
        quantity: item.quantity,
        stockBefore: currentStock,
        stockAfter,
        unitCost: item.unitPrice,
        totalCost: item.subtotal,
        referenceId: transferId,
        referenceType: "transfer",
        operatorId: request.auth!.uid,
        notes: (transfer["notes"] as string | null) ?? null,
        requestId: payload.requestId,
        operationId: `${operationId}_in_${i}`,
        createdAt: now,
      });
      tx.update(destSnap.ref, { currentStock: stockAfter, updatedAt: now });
    }

    // 2. Mark transfer as completed
    tx.update(transferRef, {
      status: "completed",
      destinationClubId,
      completedAt: now,
      updatedAt: now,
    });

    // 3. Update notification
    const notifRef = db
      .collection(COLLECTIONS.OWNER_NOTIFICATIONS(ownerId))
      .doc(transferId);
    tx.set(notifRef, { status: "accepted", acceptedAt: now, read: true }, { merge: true });

    // 4. Journal entry for bayar only (pinjam = free, no journal)
    if (paymentType === "bayar") {
      writeJournalEntry(tx, {
        ownerId,
        clubId: destinationClubId,
        entryType: "stock_transfer",
        amount: total,
        debitAccount: ACCOUNT_CODES.COGS as AccountCode,
        creditAccount: ACCOUNT_CODES.CASH as AccountCode,
        description: `Transfer masuk dari owner ${sourceOwnerId}`,
        requestId: payload.requestId,
        operationId,
        referenceId: transferId,
        referenceType: "replenishment",
        operatorId: request.auth!.uid,
      });
    }

    await markOperationComplete(tx, operationId, idempotencyPath, {
      transferId,
      destinationClubId,
    });
  });

  return {
    transferId,
    destinationClubId,
    items,
    total,
    paymentType,
    sourceOwnerId,
  };
});
