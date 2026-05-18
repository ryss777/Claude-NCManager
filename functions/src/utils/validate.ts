import * as functions from "firebase-functions";
import type { ZodSchema } from "zod";

export function validatePayload<T>(
  schema: ZodSchema<T>,
  data: unknown
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new functions.https.HttpsError(
      "invalid-argument",
      result.error.issues.map((i) => i.message).join("; ")
    );
  }
  return result.data;
}

export function requireAuth(
  context: functions.https.CallableContext
): asserts context is functions.https.CallableContext & {
  auth: NonNullable<functions.https.CallableContext["auth"]>;
} {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      "unauthenticated",
      "Authentication required"
    );
  }
}

export function requireRole(
  context: functions.https.CallableContext,
  role: string
): void {
  requireAuth(context);
  if (context.auth.token["role"] !== role) {
    throw new functions.https.HttpsError(
      "permission-denied",
      `Role '${role}' required`
    );
  }
}
