import * as functions from "firebase-functions";

// TODO: Phase 2 — Finance Engine implementation
export const finance_openShift = functions.https.onCall(async (_data, _context) => {
  return { status: "not_implemented" };
});

export const finance_closeShift = functions.https.onCall(async (_data, _context) => {
  return { status: "not_implemented" };
});
