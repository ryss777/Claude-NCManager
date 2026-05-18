import { onCall } from "firebase-functions/v2/https";

// TODO: Phase 2 — Membership Engine implementation
export const membership_activate = onCall(async (_request) => {
  return { status: "not_implemented" };
});

export const membership_deductVisit = onCall(async (_request) => {
  return { status: "not_implemented" };
});
