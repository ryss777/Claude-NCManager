import { onCall } from "firebase-functions/v2/https";

// TODO: Phase 2 — Finance Engine implementation
export const finance_openShift = onCall(async (_request) => {
  return { status: "not_implemented" };
});

export const finance_closeShift = onCall(async (_request) => {
  return { status: "not_implemented" };
});
