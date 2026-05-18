import { onCall } from "firebase-functions/v2/https";
import { validatePayload, requireRole } from "../utils/validate";
import { operatorLoginSchema, registerDeviceSchema } from "@nc-manager/validation";

export const auth_operatorLogin = onCall(async (_request) => {
  // TODO: Phase 2 — PIN validation + device check + custom claims
  return { status: "not_implemented" };
});

export const auth_registerDevice = onCall(async (request) => {
  requireRole(request, "owner");
  validatePayload(registerDeviceSchema, request.data);
  // TODO: Phase 2 — device registration + FCM token storage
  return { status: "not_implemented" };
});

export const auth_setCustomClaims = onCall(async (request) => {
  requireRole(request, "owner");
  // TODO: Phase 2 — set role/ownerId/clubId/deviceId claims
  return { status: "not_implemented" };
});
