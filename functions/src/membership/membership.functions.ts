import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "../utils/admin";
import { validatePayload, requireRole, requireAuth } from "../utils/validate";
import { checkIdempotency, throwIfDuplicate, markOperationComplete } from "../utils/idempotency";
import {
  createMembershipPlanSchema,
  createLockerPlanSchema,
  activateMembershipSchema,
  deductVisitSchema,
  upgradeMembershipSchema,
  deactivatePlanSchema,
  deletePlanSchema,
  lockerTopUpSchema,
  lockerRecordVisitSchema,
} from "@nc-manager/validation";
import { COLLECTIONS, ACCOUNT_CODES } from "@nc-manager/shared-constants";
import type { AccountCode } from "@nc-manager/shared-types";
import { writeJournalEntry } from "../finance/finance.helpers";

// ── membership_createPlan ─────────────────────────────────────────────────────

export const membership_createPlan = onCall(async (request) => {
  requireRole(request, "owner");

  const rawPlanType = (request.data as Record<string, unknown>)["planType"] as string | undefined;
  const planRef = db.collection(
    COLLECTIONS.MEMBERSHIP_PLANS(
      (request.data as Record<string, unknown>)["ownerId"] as string,
      (request.data as Record<string, unknown>)["clubId"] as string
    )
  ).doc();
  const now = new Date().toISOString();

  if (rawPlanType === "locker") {
    const payload = validatePayload(createLockerPlanSchema, request.data);
    await planRef.set({
      id: planRef.id,
      ownerId: payload.ownerId,
      clubId: payload.clubId,
      planType: "locker",
      name: payload.name,
      visitQuota: payload.visitQuota,
      blendingFeePerSession: payload.blendingFeePerSession,
      hasExpiry: payload.hasExpiry,
      durationDays: payload.hasExpiry ? (payload.durationDays ?? null) : null,
      benefits: payload.benefits,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  } else {
    const payload = validatePayload(createMembershipPlanSchema, request.data);
    await planRef.set({
      id: planRef.id,
      ownerId: payload.ownerId,
      clubId: payload.clubId,
      planType: "regular",
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
  }

  return { planId: planRef.id };
});

// ── membership_activate ───────────────────────────────────────────────────────

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

  if (!planSnap.exists) throw new HttpsError("not-found", "Membership plan not found");

  const plan = planSnap.data()!;
  if (!(plan["isActive"] as boolean)) {
    throw new HttpsError("failed-precondition", "Membership plan is inactive");
  }

  const planType = (plan["planType"] as string | undefined) ?? "regular";
  const isLocker = planType === "locker";

  const [existingSnap, pendingSnap] = await Promise.all([
    db.collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId))
      .where("customerId", "==", customerId)
      .where("status", "==", "active")
      .limit(1)
      .get(),
    db.collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId))
      .where("customerId", "==", customerId)
      .where("status", "==", "pending_next")
      .limit(1)
      .get(),
  ]);

  if (!pendingSnap.empty) {
    throw new HttpsError(
      "failed-precondition",
      "Sudah ada paket antrian. Hapus antrian dulu sebelum menambah yang baru."
    );
  }

  const existingMem = existingSnap.empty ? null : existingSnap.docs[0]!;
  const existingPlanType = existingMem
    ? ((existingMem.data()["planType"] as string | undefined) ?? "regular")
    : "regular";
  const existingVisitRemaining = existingMem
    ? (existingPlanType === "locker"
        ? ((existingMem.data()["blendingCredits"] as number) ?? 0)
        : ((existingMem.data()["visitRemaining"] as number) ?? 0))
    : 0;

  // Queue as pending_next if the active membership still has quota left
  const shouldQueue = existingMem !== null && existingVisitRemaining > 0;

  const now = new Date().toISOString();
  const hasExpiry = (plan["hasExpiry"] as boolean) ?? true;
  const durationDays = plan["durationDays"] as number | null;

  // expiresAt is calculated at activation time, not now, for pending_next
  const expiresAt = shouldQueue
    ? null
    : (hasExpiry && durationDays ? new Date(Date.now() + durationDays * 86_400_000).toISOString() : null);

  const membershipRef = db.collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId)).doc();
  const visitQuota = isLocker ? ((plan["visitQuota"] as number) ?? 0) : (plan["visitQuota"] as number);
  const price = isLocker ? 0 : (plan["price"] as number);

  // Partial payment / debt handling
  const amountPaid = payload.amountPaid != null ? payload.amountPaid : price;
  const paymentMethod = payload.paymentMethod ?? "cash";
  const remainingDebt = Math.max(0, price - amountPaid);
  const hasDebt = price > 0 && remainingDebt > 0;
  const debtRef = hasDebt
    ? db.collection(COLLECTIONS.DEBTS(ownerId, clubId)).doc()
    : null;

  await db.runTransaction(async (tx) => {
    if (!shouldQueue && existingMem) {
      tx.update(existingMem.ref, { status: "expired", updatedAt: now });
    }

    tx.set(membershipRef, {
      id: membershipRef.id,
      ownerId, clubId, customerId, planId,
      planName: plan["name"] as string,
      planType,
      tier: isLocker ? "locker" : (plan["tier"] as string),
      status: shouldQueue ? "pending_next" : "active",
      visitQuota,
      visitUsed: 0,
      visitRemaining: isLocker ? null : visitQuota,
      balance: 0,
      blendingCredits: isLocker ? visitQuota : null,
      blendingFeePerSession: isLocker ? (plan["blendingFeePerSession"] as number) : null,
      hasExpiry,
      durationDays: durationDays ?? null,
      activatedAt: shouldQueue ? null : now,
      expiresAt,
      debtId: debtRef?.id ?? null,
      createdAt: now,
      updatedAt: now,
    });

    if (!shouldQueue) {
      const customerRef = db.collection(COLLECTIONS.CUSTOMERS(ownerId, clubId)).doc(customerId);
      tx.update(customerRef, { activeMembershipId: membershipRef.id, updatedAt: now });
    }

    if (price > 0) {
      // Journal: cash portion received
      if (amountPaid > 0) {
        writeJournalEntry(tx, {
          ownerId, clubId,
          entryType: "membership_payment",
          amount: amountPaid,
          debitAccount: ACCOUNT_CODES.CASH as AccountCode,
          creditAccount: ACCOUNT_CODES.MEMBERSHIP_REVENUE as AccountCode,
          description: `Membership ${shouldQueue ? "queued" : "activation"} — ${plan["name"] as string} untuk ${customerId}`,
          requestId: payload.requestId,
          operationId,
          referenceId: membershipRef.id,
          referenceType: "membership",
        });
      }
      // Journal: debt portion as accounts receivable
      if (hasDebt) {
        writeJournalEntry(tx, {
          ownerId, clubId,
          entryType: "membership_payment",
          amount: remainingDebt,
          debitAccount: ACCOUNT_CODES.ACCOUNTS_RECEIVABLE as AccountCode,
          creditAccount: ACCOUNT_CODES.MEMBERSHIP_REVENUE as AccountCode,
          description: `Piutang membership — ${plan["name"] as string} untuk ${customerId}`,
          requestId: payload.requestId,
          operationId: `${operationId}_ar`,
          referenceId: membershipRef.id,
          referenceType: "membership",
        });
      }
    }

    if (debtRef) {
      tx.set(debtRef, {
        id: debtRef.id,
        ownerId, clubId, customerId,
        source: "membership",
        referenceId: membershipRef.id,
        referenceLabel: plan["name"] as string,
        totalAmount: price,
        paidAmount: amountPaid,
        remainingAmount: remainingDebt,
        status: amountPaid === 0 ? "outstanding" : "partial",
        payments: amountPaid > 0
          ? [{ amount: amountPaid, paymentMethod, notes: null, paidAt: now }]
          : [],
        createdAt: now,
        updatedAt: now,
      });
    }

    await markOperationComplete(tx, operationId, idempotencyPath, {
      membershipId: membershipRef.id,
      queued: shouldQueue,
      debtId: debtRef?.id ?? null,
    });
  });

  return {
    membershipId: membershipRef.id,
    expiresAt,
    planType,
    queued: shouldQueue,
    debtId: debtRef?.id ?? null,
    remainingDebt,
  };
});

// ── membership_deductVisit ────────────────────────────────────────────────────

export const membership_deductVisit = onCall(async (request) => {
  requireRole(request, "operator");

  const payload = validatePayload(deductVisitSchema, request.data);
  const { ownerId, clubId, operationId, membershipId, customerId, transactionId } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const membershipRef = db.collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId)).doc(membershipId);
  const membershipSnap = await membershipRef.get();
  if (!membershipSnap.exists) throw new HttpsError("not-found", "Membership not found");

  const membership = membershipSnap.data()!;
  if ((membership["status"] as string) !== "active") {
    throw new HttpsError("failed-precondition", "Membership is not active");
  }
  if ((membership["customerId"] as string) !== customerId) {
    throw new HttpsError("permission-denied", "Membership does not belong to this customer");
  }

  const visitRemaining = membership["visitRemaining"] as number;
  if (visitRemaining <= 0) throw new HttpsError("resource-exhausted", "No visits remaining");

  const expiresAtRaw = membership["expiresAt"] as string | null;
  if (expiresAtRaw && new Date(expiresAtRaw) < new Date()) {
    await membershipRef.update({ status: "expired", updatedAt: new Date().toISOString() });
    throw new HttpsError("failed-precondition", "Membership has expired");
  }

  const visitsAfter = visitRemaining - 1;
  const now = new Date().toISOString();
  const visitRef = db.collection(COLLECTIONS.MEMBERSHIP_VISITS(ownerId, clubId)).doc();

  // Pre-fetch pending_next before entering transaction (reads must precede writes)
  const pendingNextSnap = visitsAfter === 0
    ? await db.collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId))
        .where("customerId", "==", customerId)
        .where("status", "==", "pending_next")
        .limit(1)
        .get()
    : null;

  await db.runTransaction(async (tx) => {
    tx.create(visitRef, {
      id: visitRef.id,
      ownerId, clubId, membershipId, customerId, transactionId,
      visitsBefore: visitRemaining,
      visitsAfter,
      requestId: payload.requestId,
      operationId,
      createdAt: now,
    });
    tx.update(membershipRef, {
      visitUsed: (membership["visitUsed"] as number) + 1,
      visitRemaining: visitsAfter,
      status: visitsAfter === 0 ? "expired" : "active",
      updatedAt: now,
    });

    if (visitsAfter === 0 && pendingNextSnap && !pendingNextSnap.empty) {
      const pendingDoc = pendingNextSnap.docs[0]!;
      const pending = pendingDoc.data();
      const pendingHasExpiry = pending["hasExpiry"] as boolean;
      const pendingDurationDays = pending["durationDays"] as number | null;
      const pendingExpiresAt =
        pendingHasExpiry && pendingDurationDays
          ? new Date(Date.now() + pendingDurationDays * 86_400_000).toISOString()
          : null;
      tx.update(pendingDoc.ref, {
        status: "active",
        activatedAt: now,
        expiresAt: pendingExpiresAt,
        updatedAt: now,
      });
      const customerRef = db.collection(COLLECTIONS.CUSTOMERS(ownerId, clubId)).doc(customerId);
      tx.update(customerRef, { activeMembershipId: pendingDoc.id, updatedAt: now });
    }

    await markOperationComplete(tx, operationId, idempotencyPath, {
      visitId: visitRef.id,
      visitsAfter,
    });
  });

  return { visitId: visitRef.id, visitsRemaining: visitsAfter };
});

// ── membership_upgrade ────────────────────────────────────────────────────────

export const membership_upgrade = onCall(async (request) => {
  requireAuth(request);
  const role = (request.auth.token as Record<string, unknown>)["role"] as string;
  if (role !== "operator" && role !== "owner") {
    throw new HttpsError("permission-denied", "Operator or owner role required");
  }

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
  const newVisitQuota = newPlan["visitQuota"] as number;
  const newHasExpiry = (newPlan["hasExpiry"] as boolean) ?? true;
  const newDurationDays = newPlan["durationDays"] as number | null;
  const expiresAt =
    newHasExpiry && newDurationDays
      ? new Date(Date.now() + newDurationDays * 86_400_000).toISOString()
      : null;
  const newMembershipRef = db.collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId)).doc();

  await db.runTransaction(async (tx) => {
    tx.update(currentSnap.ref, { status: "expired", updatedAt: now });
    tx.set(newMembershipRef, {
      id: newMembershipRef.id,
      ownerId, clubId, customerId,
      planId: newPlanId,
      planName: newPlan["name"] as string,
      planType: (newPlan["planType"] as string | undefined) ?? "regular",
      tier: newPlan["tier"] as string,
      status: "active",
      visitQuota: newVisitQuota,
      visitUsed: 0,
      visitRemaining: newVisitQuota,
      balance: 0,
      blendingCredits: null,
      blendingFeePerSession: null,
      activatedAt: now,
      expiresAt,
      createdAt: now,
      updatedAt: now,
    });
    tx.update(
      db.collection(COLLECTIONS.CUSTOMERS(ownerId, clubId)).doc(customerId),
      { activeMembershipId: newMembershipRef.id, updatedAt: now }
    );
    writeJournalEntry(tx, {
      ownerId, clubId,
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
    await markOperationComplete(tx, operationId, idempotencyPath, { newMembershipId: newMembershipRef.id });
  });

  return { newMembershipId: newMembershipRef.id, expiresAt };
});

// ── membership_deactivatePlan ─────────────────────────────────────────────────

export const membership_deactivatePlan = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(deactivatePlanSchema, request.data);
  const { ownerId, clubId, planId } = payload;

  const planRef = db.collection(COLLECTIONS.MEMBERSHIP_PLANS(ownerId, clubId)).doc(planId);
  const planSnap = await planRef.get();
  if (!planSnap.exists) throw new HttpsError("not-found", "Plan not found");

  const now = new Date().toISOString();
  const memSnap = await db
    .collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId))
    .where("planId", "==", planId)
    .where("status", "==", "active")
    .get();

  const batch = db.batch();
  batch.update(planRef, { isActive: false, updatedAt: now });

  for (const mem of memSnap.docs) {
    const notifRef = db.collection(COLLECTIONS.CUSTOMER_NOTIFICATIONS(ownerId, clubId)).doc();
    batch.set(notifRef, {
      id: notifRef.id,
      customerId: mem.data()["customerId"] as string,
      type: "plan_deactivated",
      title: "Paket membership dinonaktifkan",
      body: `Paket "${planSnap.data()!["name"] as string}" sudah tidak tersedia untuk dibeli. Sisa kunjungan Anda tetap berlaku.`,
      planId, planName: planSnap.data()!["name"] as string,
      read: false, createdAt: now,
    });
  }

  await batch.commit();
  return { planId, deactivated: true, notifiedCount: memSnap.size };
});

// ── membership_deletePlan ─────────────────────────────────────────────────────

export const membership_deletePlan = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(deletePlanSchema, request.data);
  const { ownerId, clubId, planId, operationId } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const planRef = db.collection(COLLECTIONS.MEMBERSHIP_PLANS(ownerId, clubId)).doc(planId);
  const planSnap = await planRef.get();
  if (!planSnap.exists) throw new HttpsError("not-found", "Plan not found");

  const planName = planSnap.data()!["name"] as string;
  const now = new Date().toISOString();
  const membershipsCol = COLLECTIONS.MEMBERSHIPS(ownerId, clubId);

  // Fetch active memberships AND pending_next memberships for this plan in parallel
  const [activeSnap, pendingThisPlanSnap] = await Promise.all([
    db.collection(membershipsCol).where("planId", "==", planId).where("status", "==", "active").get(),
    db.collection(membershipsCol).where("planId", "==", planId).where("status", "==", "pending_next").get(),
  ]);

  // For each customer whose active membership is being deleted,
  // look up whether they have a pending_next for a DIFFERENT plan (to auto-activate).
  const activeCustomerIds = activeSnap.docs.map((d) => d.data()["customerId"] as string);
  const pendingNextMap = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

  if (activeCustomerIds.length > 0) {
    const pendingSnaps = await Promise.all(
      activeCustomerIds.map((cid) =>
        db.collection(membershipsCol)
          .where("customerId", "==", cid)
          .where("status", "==", "pending_next")
          .limit(1)
          .get()
      )
    );
    for (let i = 0; i < activeCustomerIds.length; i++) {
      const snap = pendingSnaps[i]!;
      if (!snap.empty) {
        const doc = snap.docs[0]!;
        // Only queue for auto-activation if it belongs to a different plan
        if ((doc.data()["planId"] as string) !== planId) {
          pendingNextMap.set(activeCustomerIds[i]!, doc);
        }
      }
    }
  }

  const batch = db.batch();
  batch.delete(planRef);

  // ── Handle active memberships ──
  for (const mem of activeSnap.docs) {
    const customerId = mem.data()["customerId"] as string;
    batch.update(mem.ref, { status: "cancelled", visitRemaining: 0, updatedAt: now });

    const pendingNext = pendingNextMap.get(customerId);
    if (pendingNext) {
      // Auto-activate the queued plan
      const pd = pendingNext.data();
      const pendingExpiresAt =
        (pd["hasExpiry"] as boolean) && (pd["durationDays"] as number | null)
          ? new Date(Date.now() + (pd["durationDays"] as number) * 86_400_000).toISOString()
          : null;
      batch.update(pendingNext.ref, {
        status: "active",
        activatedAt: now,
        expiresAt: pendingExpiresAt,
        updatedAt: now,
      });
      batch.update(
        db.collection(COLLECTIONS.CUSTOMERS(ownerId, clubId)).doc(customerId),
        { activeMembershipId: pendingNext.id, updatedAt: now }
      );
      const notifRef = db.collection(COLLECTIONS.CUSTOMER_NOTIFICATIONS(ownerId, clubId)).doc();
      batch.set(notifRef, {
        id: notifRef.id, customerId,
        type: "plan_deleted",
        title: "Paket membership dihapus",
        body: `Paket "${planName}" telah dihapus. Paket antrian "${pd["planName"] as string}" otomatis diaktifkan.`,
        planId, planName, read: false, createdAt: now,
      });
    } else {
      batch.update(
        db.collection(COLLECTIONS.CUSTOMERS(ownerId, clubId)).doc(customerId),
        { activeMembershipId: null, updatedAt: now }
      );
      const notifRef = db.collection(COLLECTIONS.CUSTOMER_NOTIFICATIONS(ownerId, clubId)).doc();
      batch.set(notifRef, {
        id: notifRef.id, customerId,
        type: "plan_deleted",
        title: "Paket membership dihapus",
        body: `Paket "${planName}" telah dihapus. Membership Anda otomatis berakhir dan sisa kunjungan hangus.`,
        planId, planName, read: false, createdAt: now,
      });
    }
  }

  // ── Handle pending_next memberships for this plan — simply cancel them ──
  for (const mem of pendingThisPlanSnap.docs) {
    batch.update(mem.ref, { status: "cancelled", updatedAt: now });
  }

  const idempotencyRef = db.doc(`${idempotencyPath}/${operationId}`);
  batch.set(idempotencyRef, {
    planId,
    cancelledCount: activeSnap.size,
    pendingCancelledCount: pendingThisPlanSnap.size,
    completedAt: now,
  });

  await batch.commit();
  return {
    planId,
    deleted: true,
    cancelledCount: activeSnap.size,
    pendingCancelledCount: pendingThisPlanSnap.size,
  };
});

// ── locker_topUp ─────────────────────────────────────────────────────────────
//
// Owner/operator adds prepaid blending credits to a locker membership.
// Customer pays sessions × blendingFeePerSession upfront.

export const locker_topUp = onCall(async (request) => {
  requireAuth(request);
  const role = (request.auth.token as Record<string, unknown>)["role"] as string;
  if (role !== "operator" && role !== "owner") {
    throw new HttpsError("permission-denied", "Operator or owner role required");
  }

  const payload = validatePayload(lockerTopUpSchema, request.data);
  const { ownerId, clubId, operationId, membershipId, customerId, sessions } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const membershipRef = db.collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId)).doc(membershipId);
  const membershipSnap = await membershipRef.get();
  if (!membershipSnap.exists) throw new HttpsError("not-found", "Membership tidak ditemukan");

  const membership = membershipSnap.data()!;
  if ((membership["status"] as string) !== "active") {
    throw new HttpsError("failed-precondition", "Membership tidak aktif");
  }
  if ((membership["customerId"] as string) !== customerId) {
    throw new HttpsError("permission-denied", "Membership bukan milik customer ini");
  }
  if ((membership["planType"] as string) !== "locker") {
    throw new HttpsError("failed-precondition", "Ini bukan membership loker");
  }

  const blendingFeePerSession = membership["blendingFeePerSession"] as number;
  const currentCredits = membership["blendingCredits"] as number;
  const total = sessions * blendingFeePerSession;
  const now = new Date().toISOString();

  await db.runTransaction(async (tx) => {
    tx.update(membershipRef, {
      blendingCredits: currentCredits + sessions,
      updatedAt: now,
    });

    if (total > 0) {
      writeJournalEntry(tx, {
        ownerId, clubId,
        entryType: "membership_payment",
        amount: total,
        debitAccount: ACCOUNT_CODES.CASH as AccountCode,
        creditAccount: ACCOUNT_CODES.MEMBERSHIP_REVENUE as AccountCode,
        description: `Top-up loker ${sessions} sesi — customer ${customerId}`,
        requestId: payload.requestId,
        operationId,
        referenceId: membershipId,
        referenceType: "membership",
      });
    }

    await markOperationComplete(tx, operationId, idempotencyPath, {
      membershipId, sessions, creditsAfter: currentCredits + sessions,
    });
  });

  return { membershipId, sessions, creditsAfter: currentCredits + sessions, total };
});

// ── locker_recordVisit ────────────────────────────────────────────────────────
//
// Operator records a blending visit. Deducts guestCount credits (if paymentType
// is "credits") or records a cash charge (if paymentType is "cash").

export const locker_recordVisit = onCall(async (request) => {
  requireAuth(request);
  const role = (request.auth.token as Record<string, unknown>)["role"] as string;
  if (role !== "operator" && role !== "owner") {
    throw new HttpsError("permission-denied", "Operator or owner role required");
  }

  const payload = validatePayload(lockerRecordVisitSchema, request.data);
  const { ownerId, clubId, operationId, membershipId, customerId, guestCount, paymentType } = payload;

  const idempotencyPath = `owners/${ownerId}/clubs/${clubId}/_idempotency`;
  const isDuplicate = await checkIdempotency(operationId, idempotencyPath);
  throwIfDuplicate(isDuplicate, operationId);

  const membershipRef = db.collection(COLLECTIONS.MEMBERSHIPS(ownerId, clubId)).doc(membershipId);
  const membershipSnap = await membershipRef.get();
  if (!membershipSnap.exists) throw new HttpsError("not-found", "Membership tidak ditemukan");

  const membership = membershipSnap.data()!;
  if ((membership["status"] as string) !== "active") {
    throw new HttpsError("failed-precondition", "Membership tidak aktif");
  }
  if ((membership["customerId"] as string) !== customerId) {
    throw new HttpsError("permission-denied", "Membership bukan milik customer ini");
  }
  if ((membership["planType"] as string) !== "locker") {
    throw new HttpsError("failed-precondition", "Ini bukan membership loker");
  }

  const currentCredits = membership["blendingCredits"] as number;
  const blendingFeePerSession = membership["blendingFeePerSession"] as number;
  const visitUsed = (membership["visitUsed"] as number) ?? 0;

  if (paymentType === "credits" && currentCredits < guestCount) {
    throw new HttpsError(
      "resource-exhausted",
      `Kredit tidak cukup. Tersisa ${currentCredits} sesi, butuh ${guestCount}`
    );
  }

  // Expiry check
  const expiresAtRaw = membership["expiresAt"] as string | null;
  if (expiresAtRaw && new Date(expiresAtRaw) < new Date()) {
    await membershipRef.update({ status: "expired", updatedAt: new Date().toISOString() });
    throw new HttpsError("failed-precondition", "Membership loker sudah kadaluarsa");
  }

  const creditsBefore = currentCredits;
  const creditsAfter = paymentType === "credits" ? currentCredits - guestCount : currentCredits;
  const now = new Date().toISOString();
  const visitRef = db.collection(COLLECTIONS.MEMBERSHIP_VISITS(ownerId, clubId)).doc();

  await db.runTransaction(async (tx) => {
    const updates: Record<string, unknown> = { visitUsed: visitUsed + guestCount, updatedAt: now };
    if (paymentType === "credits") updates["blendingCredits"] = creditsAfter;
    tx.update(membershipRef, updates);

    tx.create(visitRef, {
      id: visitRef.id,
      ownerId, clubId, membershipId, customerId,
      visitType: "locker_blending",
      guestCount,
      paymentType,
      creditsBefore,
      creditsAfter,
      blendingFeePerSession,
      totalCharge: paymentType === "cash" ? guestCount * blendingFeePerSession : 0,
      requestId: payload.requestId,
      operationId,
      operatorId: request.auth!.uid,
      createdAt: now,
    });

    if (paymentType === "cash") {
      const total = guestCount * blendingFeePerSession;
      if (total > 0) {
        writeJournalEntry(tx, {
          ownerId, clubId,
          entryType: "membership_payment",
          amount: total,
          debitAccount: ACCOUNT_CODES.CASH as AccountCode,
          creditAccount: ACCOUNT_CODES.MEMBERSHIP_REVENUE as AccountCode,
          description: `Jasa blender tunai — ${guestCount} tamu`,
          requestId: payload.requestId,
          operationId,
          referenceId: membershipId,
          referenceType: "membership",
        });
      }
    }

    await markOperationComplete(tx, operationId, idempotencyPath, {
      visitId: visitRef.id, creditsAfter,
    });
  });

  return { visitId: visitRef.id, creditsAfter, guestCount, paymentType };
});
