import { HttpsError } from "firebase-functions/v2/https";
import { db } from "./admin";

export async function checkIdempotency(
  operationId: string,
  collectionPath: string
): Promise<boolean> {
  const doc = await db.doc(`${collectionPath}/${operationId}`).get();
  return doc.exists;
}

export async function markOperationComplete(
  tx: FirebaseFirestore.Transaction,
  operationId: string,
  collectionPath: string,
  resultData: Record<string, unknown>
): Promise<void> {
  const ref = db.doc(`${collectionPath}/${operationId}`);
  tx.set(ref, { ...resultData, completedAt: new Date().toISOString() });
}

export function throwIfDuplicate(isDuplicate: boolean, operationId: string): void {
  if (isDuplicate) {
    throw new HttpsError(
      "already-exists",
      `Operation ${operationId} already processed`
    );
  }
}
