import * as functions from "firebase-functions";

// TODO: Phase 2 — Membership Engine implementation
export const membership_activate = functions.https.onCall(async (_data, _context) => {
  return { status: "not_implemented" };
});

export const membership_deductVisit = functions.https.onCall(async (_data, _context) => {
  return { status: "not_implemented" };
});
