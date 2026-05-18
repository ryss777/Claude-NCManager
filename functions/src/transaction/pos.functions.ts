import * as functions from "firebase-functions";
import { db, FieldValue } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import {
  createTransactionSchema,
  reverseTransactionSchema,
  startMakingSchema,
  completeTransactionSchema,
} from "@nc-manager/validation";
import { COLLECTIONS } from "@nc-manager/shared-constants";

export const pos_createTransaction = functions.https.onCall(async (data, context) => {
  requireRole(context, "operator");

  const payload = validatePayload(createTransactionSchema, data);
  const { ownerId, clubId, operationId } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const transactionRef = db
    .collection(COLLECTIONS.TRANSACTIONS(ownerId, clubId))
    .doc();

  const subtotal = payload.items.reduce((sum, item) => sum + item.subtotal, 0);
  const discount = payload.discount ?? 0;
  const total = subtotal - discount;
  const change = payload.amountPaid - total;

  const now = new Date().toISOString();
  const txData = {
    id: transactionRef.id,
    ownerId,
    clubId,
    operatorId: context.auth!.uid,
    deviceId: context.auth!.token["deviceId"] as string,
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
    operationId: payload.operationId,
    createdAt: now,
    updatedAt: now,
  };

  await db.runTransaction(async (tx) => {
    tx.set(transactionRef, txData);
    await markOperationComplete(operationId, idempotencyPath, {
      transactionId: transactionRef.id,
    });
  });

  return { transactionId: transactionRef.id };
});

export const pos_startMaking = functions.https.onCall(async (data, context) => {
  requireRole(context, "operator");
  const payload = validatePayload(startMakingSchema, data);

  // TODO: Phase 2 — implement full making workflow
  return { status: "making" };
});

export const pos_completeTransaction = functions.https.onCall(async (data, context) => {
  requireRole(context, "operator");
  const payload = validatePayload(completeTransactionSchema, data);

  // TODO: Phase 2 — implement full completion with inventory + finance
  return { status: "completed" };
});

export const pos_reverseTransaction = functions.https.onCall(async (data, context) => {
  requireRole(context, "owner");
  const payload = validatePayload(reverseTransactionSchema, data);

  // TODO: Phase 2 — implement reversal with journal correction
  return { status: "reversed" };
});
