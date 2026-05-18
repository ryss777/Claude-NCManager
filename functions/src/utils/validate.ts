import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import type { ZodSchema } from "zod";

export function validatePayload<T>(schema: ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpsError(
      "invalid-argument",
      result.error.issues.map((i) => i.message).join("; ")
    );
  }
  return result.data;
}

export function requireAuth(request: CallableRequest): asserts request is CallableRequest & {
  auth: NonNullable<CallableRequest["auth"]>;
} {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Authentication required");
  }
}

export function requireRole(request: CallableRequest, role: string): void {
  requireAuth(request);
  if ((request.auth.token as Record<string, unknown>)["role"] !== role) {
    throw new HttpsError("permission-denied", `Role '${role}' required`);
  }
}
