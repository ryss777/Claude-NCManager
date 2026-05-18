import { db } from "./admin";
import * as functions from "firebase-functions";

export async function checkIdempotency(
  operationId: string,
  collectionPath: string
): Promise<boolean> {
  const doc = await db.doc(`${collectionPath}/${operationId}`).get();
  return doc.exists;
}

export async function markOperationComplete(
  operationId: string,
  collectionPath: string,
  resultData: Record<string, unknown>
): Promise<void> {
  await db.doc(`${collectionPath}/${operationId}`).set({
    ...resultData,
    completedAt: new Date().toISOString(),
  });
}

export function throwIfDuplicate(isDuplicate: boolean, operationId: string): void {
  if (isDuplicate) {
    throw new functions.https.HttpsError(
      "already-exists",
      `Operation ${operationId} already processed`
    );
  }
}
