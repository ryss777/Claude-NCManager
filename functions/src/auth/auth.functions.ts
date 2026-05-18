import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { auth } from "../utils/admin";
import { validatePayload, requireRole } from "../utils/validate";
import { operatorLoginSchema, registerDeviceSchema } from "@nc-manager/validation";

export const auth_operatorLogin = functions.https.onCall(async (data, context) => {
  // TODO: Phase 2 — PIN validation + device check + custom claims
  return { status: "not_implemented" };
});

export const auth_registerDevice = functions.https.onCall(async (data, context) => {
  requireRole(context, "owner");
  const payload = validatePayload(registerDeviceSchema, data);

  // TODO: Phase 2 — device registration + FCM token storage
  return { status: "not_implemented" };
});

export const auth_setCustomClaims = functions.https.onCall(async (data, context) => {
  requireRole(context, "owner");
  // TODO: Phase 2 — set role/ownerId/clubId/deviceId claims
  return { status: "not_implemented" };
});
