import { onCall } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { createCustomerSchema } from "@nc-manager/validation";
import { COLLECTIONS } from "@nc-manager/shared-constants";

export const customer_create = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(createCustomerSchema, request.data);
  const { ownerId, clubId, displayName, phone, email, notes } = payload;

  const ref = db.collection(COLLECTIONS.CUSTOMERS(ownerId, clubId)).doc();
  const now = new Date().toISOString();

  await ref.set({
    id: ref.id,
    ownerId,
    clubId,
    displayName,
    phone: phone ?? null,
    email: email ?? null,
    notes: notes ?? null,
    activeMembershipId: null,
    createdAt: now,
    updatedAt: now,
  });

  return { customerId: ref.id };
});
