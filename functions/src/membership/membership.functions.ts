import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole, requireAuth } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import {
  createMembershipPlanSchema,
  activateMembershipSchema,
  deductVisitSchema,
  upgradeMembershipSchema,
} from "@nc-manager/validation";
import { COLLECTIONS, ACCOUNT_CODES } from "@nc-manager/shared-constants";
import type { AccountCode } from "@nc-manager/shared-types";
import { writeJournalEntry } from "../finance/finance.helpers";

// ── membership_createPlan ─────────────────────────────────────────────────────

export const membership_createPlan = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(createMembershipPlanSchema, request.data);
  const { ownerId, clubId } = payload;

  const planRef = db.collection(COLLECTIONS.MEMBERSHIP_PLANS(ownerId, clubId)).doc();
  const now = new Date().toISOString();

  await planRef.set({
    id: planRef.id,
    ownerId,
    clubId,
    name: payload.name,
    tier: payload.tier,
    price: payload.price,
    visitQuota: payload.visitQuota,
    hasExpiry: payload.hasExpiry,
    durationDays: payload.hasExpiry ? (payload.durationDays ?? null) : null,
    benefits: payload.benefits,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  return { planId: planRef.id };
});

// ── membership_activate ───────────────────────────────────────────────────────

/**
 * Activates a membership for a customer after payment is recorded.
 * Idempotent. Writes journal entry for membership revenue.
 */
export const membership_activate = onCall(async (request) => {
  requireAuth(request);
  const role = (request.auth.token as Record<string, unknown>)["role"] as string;
  if (role !== "operator" && role !== "owner") {
    throw new HttpsError("permission-denied", "Operator or owner role required");
  }

  const payload = validatePayload(activateMembershipSchema, request.data);
  const { ownerId, clubId, operationId, customerId, planId } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const planSnap = await db
    .collection(COLLECTIONS.MEMBERSHIP_PLANS(ownerId, clubId))
    .doc(planId)
    .get();

  if (!planSnap.exists) {
    throw new HttpsError("not-found", "Membership plan not found");
  }

  const plan = planSnap.data()!;
  if (!(plan["isActive"] as boolean)) {
    throw new HttpsError("failed-precondition", "Membership plan is inactive");
  }

  // Expire any existing active membership for this customer
  const existingSnap = await db
    .collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId))
    .where("customerId", "==", customerId)
    .where("status", "==", "active")
    .limit(1)
    .get();

  const now = new Date().toISOString();
  const activatedAt = now;
  const hasExpiry = (plan["hasExpiry"] as boolean) ?? true;
  const durationDays = plan["durationDays"] as number | null;
  const expiresAt = hasExpiry && durationDays
    ? new Date(Date.now() + durationDays * 86_400_000).toISOString()
    : null;
  const membershipRef = db.collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId)).doc();

  await db.runTransaction(async (tx) => {
    // Expire previous membership
    if (!existingSnap.empty) {
      const prev = existingSnap.docs[0];
      if (prev !== undefined) {
        tx.update(prev.ref, { status: "expired", updatedAt: now });
      }
    }

    // Create new membership
    tx.set(membershipRef, {
      id: membershipRef.id,
      ownerId,
      clubId,
      customerId,
      planId,
      planName: plan["name"] as string,
      tier: plan["tier"] as string,
      status: "active",
      visitQuota: plan["visitQuota"] as number,
      visitUsed: 0,
      visitRemaining: plan["visitQuota"] as number,
      balance: 0,
      activatedAt,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    // Update customer's activeMembershipId
    const customerRef = db
      .collection(COLLECTIONS.CUSTOMERS(ownerId, clubId))
      .doc(customerId);
    tx.update(customerRef, {
      activeMembershipId: membershipRef.id,
      updatedAt: now,
    });

    // Write membership revenue journal entry
    writeJournalEntry(tx, {
      ownerId,
      clubId,
      entryType: "membership_payment",
      amount: plan["price"] as number,
      debitAccount: ACCOUNT_CODES.CASH as AccountCode,
      creditAccount: ACCOUNT_CODES.MEMBERSHIP_REVENUE as AccountCode,
      description: `Membership activation — ${plan["name"] as string} for customer ${customerId}`,
      requestId: payload.requestId,
      operationId,
      referenceId: membershipRef.id,
      referenceType: "membership",
    });

    await markOperationComplete(tx, operationId, idempotencyPath, {
      membershipId: membershipRef.id,
    });
  });

  return { membershipId: membershipRef.id, expiresAt };
});

// ── membership_deductVisit ────────────────────────────────────────────────────

/**
 * Standalone visit deduction. Idempotent via operationId.
 * Used when deduction is triggered outside of pos_completeTransaction.
 */
export const membership_deductVisit = onCall(async (request) => {
  requireRole(request, "operator");

  const payload = validatePayload(deductVisitSchema, request.data);
  const { ownerId, clubId, operationId, membershipId, customerId, transactionId } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const membershipRef = db
    .collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId))
    .doc(membershipId);
  const membershipSnap = await membershipRef.get();

  if (!membershipSnap.exists) {
    throw new HttpsError("not-found", "Membership not found");
  }

  const membership = membershipSnap.data()!;

  if ((membership["status"] as string) !== "active") {
    throw new HttpsError("failed-precondition", "Membership is not active");
  }
  if ((membership["customerId"] as string) !== customerId) {
    throw new HttpsError("permission-denied", "Membership does not belong to this customer");
  }

  const visitRemaining = membership["visitRemaining"] as number;
  if (visitRemaining <= 0) {
    throw new HttpsError("resource-exhausted", "No visits remaining");
  }

  // Check expiry (null expiresAt means no-expiry plan)
  const expiresAtRaw = membership["expiresAt"] as string | null;
  if (expiresAtRaw && new Date(expiresAtRaw) < new Date()) {
    await membershipRef.update({ status: "expired", updatedAt: new Date().toISOString() });
    throw new HttpsError("failed-precondition", "Membership has expired");
  }

  const now = new Date().toISOString();
  const visitRef = db.collection(COLLECTIONS.MEMBERSHIP_VISITS(ownerId, clubId)).doc();

  await db.runTransaction(async (tx) => {
    tx.create(visitRef, {
      id: visitRef.id,
      ownerId,
      clubId,
      membershipId,
      customerId,
      transactionId,
      visitsBefore: visitRemaining,
      visitsAfter: visitRemaining - 1,
      requestId: payload.requestId,
      operationId,
      createdAt: now,
    });

    tx.update(membershipRef, {
      visitUsed: (membership["visitUsed"] as number) + 1,
      visitRemaining: visitRemaining - 1,
      updatedAt: now,
    });

    await markOperationComplete(tx, operationId, idempotencyPath, {
      visitId: visitRef.id,
      visitsAfter: visitRemaining - 1,
    });
  });

  return { visitId: visitRef.id, visitsRemaining: visitRemaining - 1 };
});

// ── membership_upgrade ────────────────────────────────────────────────────────

/**
 * Upgrades customer to a new membership plan mid-cycle.
 * Carries over remaining visits proportionally.
 */
export const membership_upgrade = onCall(async (request) => {
  requireRole(request, "operator");

  const payload = validatePayload(upgradeMembershipSchema, request.data);
  const { ownerId, clubId, operationId, currentMembershipId, newPlanId, customerId } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const [currentSnap, newPlanSnap] = await Promise.all([
    db.collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId)).doc(currentMembershipId).get(),
    db.collection(COLLECTIONS.MEMBERSHIP_PLANS(ownerId, clubId)).doc(newPlanId).get(),
  ]);

  if (!currentSnap.exists) throw new HttpsError("not-found", "Current membership not found");
  if (!newPlanSnap.exists) throw new HttpsError("not-found", "New plan not found");

  const current = currentSnap.data()!;
  const newPlan = newPlanSnap.data()!;

  if ((current["status"] as string) !== "active") {
    throw new HttpsError("failed-precondition", "Current membership is not active");
  }
  if ((current["customerId"] as string) !== customerId) {
    throw new HttpsError("permission-denied", "Membership does not belong to this customer");
  }

  const now = new Date().toISOString();
  const remainingVisits = current["visitRemaining"] as number;
  const newVisitQuota = newPlan["visitQuota"] as number;
  const newHasExpiry = (newPlan["hasExpiry"] as boolean) ?? true;
  const newDurationDays = newPlan["durationDays"] as number | null;
  const expiresAt = newHasExpiry && newDurationDays
    ? new Date(Date.now() + newDurationDays * 86_400_000).toISOString()
    : null;
  const newMembershipRef = db.collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId)).doc();

  await db.runTransaction(async (tx) => {
    // Expire current membership
    tx.update(currentSnap.ref, { status: "expired", updatedAt: now });

    // Create upgraded membership, carrying over remaining visits
    const carryOver = Math.min(remainingVisits, newVisitQuota);
    tx.set(newMembershipRef, {
      id: newMembershipRef.id,
      ownerId,
      clubId,
      customerId,
      planId: newPlanId,
      planName: newPlan["name"] as string,
      tier: newPlan["tier"] as string,
      status: "active",
      visitQuota: newVisitQuota,
      visitUsed: newVisitQuota - carryOver,
      visitRemaining: carryOver,
      balance: 0,
      activatedAt: now,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });

    // Update customer activeMembershipId
    tx.update(
      db.collection(COLLECTIONS.CUSTOMERS(ownerId, clubId)).doc(customerId),
      { activeMembershipId: newMembershipRef.id, updatedAt: now }
    );

    // Write membership revenue journal entry for upgrade price
    writeJournalEntry(tx, {
      ownerId,
      clubId,
      entryType: "membership_payment",
      amount: newPlan["price"] as number,
      debitAccount: ACCOUNT_CODES.CASH as AccountCode,
      creditAccount: ACCOUNT_CODES.MEMBERSHIP_REVENUE as AccountCode,
      description: `Membership upgrade to ${newPlan["name"] as string} for customer ${customerId}`,
      requestId: payload.requestId,
      operationId,
      referenceId: newMembershipRef.id,
      referenceType: "membership",
    });

    await markOperationComplete(tx, operationId, idempotencyPath, {
      newMembershipId: newMembershipRef.id,
    });
  });

  return { newMembershipId: newMembershipRef.id, expiresAt };
});
