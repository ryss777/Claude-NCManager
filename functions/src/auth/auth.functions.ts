import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db, auth } from "../utils/admin";
import { validatePayload, requireAuth, requireRole } from "../utils/validate";
import {
  operatorLoginSchema,
  registerDeviceSchema,
  createOperatorSchema,
  updateOperatorPinSchema,
  initOwnerSchema,
  refreshOwnerClaimsSchema,
} from "@nc-manager/validation";
import { COLLECTIONS } from "@nc-manager/shared-constants";
import { generateSalt, hashPin, verifyPin } from "./auth.helpers";

// ── Owner Onboarding ──────────────────────────────────────────────────────────

/**
 * Called once after owner's first Google Sign-In.
 * Creates owner + default club documents, then sets custom claims.
 */
export const auth_initOwner = onCall(async (request) => {
  requireAuth(request);

  const payload = validatePayload(initOwnerSchema, request.data);
  const uid = request.auth.uid;

  // Prevent re-initialisation
  const existingOwner = await db.doc(`owners/${uid}`).get();
  if (existingOwner.exists) {
    throw new HttpsError("already-exists", "Owner already initialised");
  }

  const now = new Date().toISOString();
  const clubId = db.collection("_").doc().id; // generate unique clubId

  await db.runTransaction(async (tx) => {
    // Owner document
    tx.set(db.doc(`owners/${uid}`), {
      id: uid,
      email: request.auth.token["email"] ?? null,
      displayName: payload.displayName,
      photoURL: request.auth.token["picture"] ?? null,
      createdAt: now,
      updatedAt: now,
    });

    // Default club document
    tx.set(db.doc(`owners/${uid}/clubs/${clubId}`), {
      id: clubId,
      ownerId: uid,
      name: payload.clubName,
      address: payload.clubAddress,
      phoneNumber: payload.clubPhoneNumber,
      timezone: payload.timezone,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  await auth.setCustomUserClaims(uid, {
    role: "owner",
    ownerId: uid,
    clubId,
  });

  return { ownerId: uid, clubId };
});

/**
 * Refreshes owner claims when switching active club.
 */
export const auth_refreshOwnerClaims = onCall(async (request) => {
  requireAuth(request);

  const payload = validatePayload(refreshOwnerClaimsSchema, request.data);
  const uid = request.auth.uid;

  // Verify the owner document belongs to this uid
  const ownerSnap = await db.doc(`owners/${uid}`).get();
  if (!ownerSnap.exists) {
    throw new HttpsError("not-found", "Owner not found");
  }

  // Verify the club belongs to this owner (admin SDK bypasses rules)
  const clubSnap = await db.doc(`owners/${payload.ownerId}/clubs/${payload.clubId}`).get();
  if (!clubSnap.exists || payload.ownerId !== uid) {
    throw new HttpsError("permission-denied", "Club not found or not yours");
  }

  await auth.setCustomUserClaims(uid, {
    role: "owner",
    ownerId: uid,
    clubId: payload.clubId,
  });

  return { success: true };
});

// ── Operator Management ───────────────────────────────────────────────────────

/**
 * Creates a new operator with a hashed PIN.
 */
export const auth_createOperator = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(createOperatorSchema, request.data);
  const { ownerId, clubId, displayName, pin, allowedDeviceIds } = payload;

  const salt = generateSalt();
  const pinHash = hashPin(pin, salt);
  const now = new Date().toISOString();
  const operatorRef = db.collection(COLLECTIONS.OPERATORS(ownerId, clubId)).doc();

  await operatorRef.set({
    id: operatorRef.id,
    ownerId,
    clubId,
    displayName,
    pinHash,
    pinSalt: salt,
    isActive: true,
    allowedDeviceIds,
    createdAt: now,
    updatedAt: now,
  });

  return { operatorId: operatorRef.id };
});

/**
 * Updates an operator's PIN. Owner can reset without currentPin; operator must provide it.
 */
export const auth_updateOperatorPin = onCall(async (request) => {
  requireAuth(request);

  const payload = validatePayload(updateOperatorPinSchema, request.data);
  const { ownerId, clubId, operatorId, currentPin, newPin } = payload;

  const callerRole = (request.auth.token as Record<string, unknown>)["role"] as string;
  const isOwner = callerRole === "owner" && request.auth.token["ownerId"] === ownerId;
  const isOperatorSelf =
    callerRole === "operator" &&
    request.auth.token["ownerId"] === ownerId &&
    request.auth.token["clubId"] === clubId;

  if (!isOwner && !isOperatorSelf) {
    throw new HttpsError("permission-denied", "Insufficient permissions");
  }

  const operatorRef = db
    .collection(COLLECTIONS.OPERATORS(ownerId, clubId))
    .doc(operatorId);
  const snap = await operatorRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Operator not found");
  }

  const op = snap.data()!;

  // Operator updating own PIN must provide current PIN
  if (isOperatorSelf) {
    if (!currentPin) {
      throw new HttpsError("invalid-argument", "currentPin required");
    }
    const valid = verifyPin(currentPin, op["pinSalt"] as string, op["pinHash"] as string);
    if (!valid) {
      throw new HttpsError("unauthenticated", "Current PIN incorrect");
    }
  }

  const newSalt = generateSalt();
  const newPinHash = hashPin(newPin, newSalt);

  await operatorRef.update({
    pinHash: newPinHash,
    pinSalt: newSalt,
    updatedAt: new Date().toISOString(),
  });

  return { success: true };
});

// ── Operator Login ────────────────────────────────────────────────────────────

/**
 * Authenticates an operator via PIN + registered device.
 * Returns a Firebase custom token the app uses to sign in.
 */
export const auth_operatorLogin = onCall(async (request) => {
  const payload = validatePayload(operatorLoginSchema, request.data);
  const { pin, deviceId, clubId, ownerId } = payload;

  // 1. Verify device is registered and active
  const deviceSnap = await db
    .collection(COLLECTIONS.REGISTERED_DEVICES(ownerId, clubId))
    .doc(deviceId)
    .get();

  if (!deviceSnap.exists) {
    throw new HttpsError("not-found", "Device not registered");
  }

  const device = deviceSnap.data()!;
  if (!(device["isActive"] as boolean)) {
    throw new HttpsError("permission-denied", "Device is inactive");
  }

  // 2. Find active operator whose PIN matches and allows this device
  const operatorsSnap = await db
    .collection(COLLECTIONS.OPERATORS(ownerId, clubId))
    .where("isActive", "==", true)
    .get();

  let matchedOperatorId: string | null = null;
  let matchedDisplayName: string | null = null;

  for (const doc of operatorsSnap.docs) {
    const op = doc.data();
    if (!verifyPin(pin, op["pinSalt"] as string, op["pinHash"] as string)) {
      continue;
    }
    const allowedDevices = op["allowedDeviceIds"] as string[];
    if (!allowedDevices.includes(deviceId)) {
      throw new HttpsError("permission-denied", "Device not allowed for this operator");
    }
    matchedOperatorId = doc.id;
    matchedDisplayName = op["displayName"] as string;
    break;
  }

  if (!matchedOperatorId || !matchedDisplayName) {
    throw new HttpsError("unauthenticated", "Invalid PIN");
  }

  // 3. Ensure Firebase Auth user exists for this operator
  const operatorUid = `operator_${ownerId}_${matchedOperatorId}`;
  try {
    await auth.getUser(operatorUid);
  } catch {
    await auth.createUser({ uid: operatorUid, displayName: matchedDisplayName });
  }

  // 4. Set custom claims (picked up after client signs in with custom token)
  const claims = { role: "operator", ownerId, clubId, deviceId, operatorId: matchedOperatorId };
  await auth.setCustomUserClaims(operatorUid, claims);

  // 5. Update device last-seen
  await deviceSnap.ref.update({ lastSeenAt: new Date().toISOString() });

  // 6. Create custom token with claims embedded for immediate availability
  const customToken = await auth.createCustomToken(operatorUid, claims);

  return { customToken, operatorId: matchedOperatorId, displayName: matchedDisplayName };
});

// ── Device Management ─────────────────────────────────────────────────────────

/**
 * Registers a new device for a club. Called by the owner from the dashboard.
 */
export const auth_registerDevice = onCall(async (request) => {
  requireRole(request, "owner");

  const payload = validatePayload(registerDeviceSchema, request.data);
  const { ownerId, clubId, deviceName, platform, fcmToken } = payload;

  const now = new Date().toISOString();
  const deviceRef = db.collection(COLLECTIONS.REGISTERED_DEVICES(ownerId, clubId)).doc();

  await deviceRef.set({
    id: deviceRef.id,
    ownerId,
    clubId,
    deviceName,
    platform,
    fcmToken: fcmToken ?? null,
    operatorId: null,
    isActive: true,
    lastSeenAt: now,
    registeredAt: now,
  });

  return { deviceId: deviceRef.id };
});

/**
 * Deactivates a registered device. Operator session on that device becomes invalid.
 */
export const auth_deactivateDevice = onCall(async (request) => {
  requireRole(request, "owner");

  const { ownerId, clubId, deviceId } = request.data as {
    ownerId: string;
    clubId: string;
    deviceId: string;
  };

  if (!ownerId || !clubId || !deviceId) {
    throw new HttpsError("invalid-argument", "ownerId, clubId, deviceId required");
  }

  const deviceRef = db
    .collection(COLLECTIONS.REGISTERED_DEVICES(ownerId, clubId))
    .doc(deviceId);
  const snap = await deviceRef.get();

  if (!snap.exists) {
    throw new HttpsError("not-found", "Device not found");
  }

  await deviceRef.update({ isActive: false, updatedAt: new Date().toISOString() });

  // Revoke tokens for the operator currently on this device (if any)
  const device = snap.data()!;
  const operatorId = device["operatorId"] as string | null;
  if (operatorId) {
    const operatorUid = `operator_${ownerId}_${operatorId}`;
    try {
      await auth.revokeRefreshTokens(operatorUid);
    } catch {
      // User may not exist — ignore
    }
  }

  return { success: true };
});
