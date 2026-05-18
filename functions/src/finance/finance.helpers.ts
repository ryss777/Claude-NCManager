import { db } from "../utils/admin";
import { COLLECTIONS, ACCOUNT_CODES } from "@nc-manager/shared-constants";
import type { JournalEntryType, AccountCode } from "@nc-manager/shared-types";

export interface JournalEntryParams {
  ownerId: string;
  clubId: string;
  entryType: JournalEntryType;
  amount: number;
  debitAccount: AccountCode;
  creditAccount: AccountCode;
  description: string;
  requestId: string;
  operationId: string;
  referenceId?: string | undefined;
  referenceType?: "transaction" | "shift" | "membership" | "manual" | undefined;
  shiftId?: string | undefined;
  operatorId?: string | undefined;
  reversedEntryId?: string | undefined;
}

/**
 * Writes an immutable journal entry within an existing Firestore transaction.
 * Called by finance, transaction, and membership engines.
 */
export function writeJournalEntry(
  tx: FirebaseFirestore.Transaction,
  params: JournalEntryParams
): string {
  const entryRef = db.collection(COLLECTIONS.FINANCE_JOURNAL(params.ownerId, params.clubId)).doc();

  tx.create(entryRef, {
    id: entryRef.id,
    ownerId: params.ownerId,
    clubId: params.clubId,
    entryType: params.entryType,
    amount: params.amount,
    debitAccount: params.debitAccount,
    creditAccount: params.creditAccount,
    description: params.description,
    requestId: params.requestId,
    operationId: params.operationId,
    referenceId: params.referenceId ?? null,
    referenceType: params.referenceType ?? null,
    shiftId: params.shiftId ?? null,
    operatorId: params.operatorId ?? null,
    reversedEntryId: params.reversedEntryId ?? null,
    createdAt: new Date().toISOString(),
  });

  return entryRef.id;
}

/**
 * Calculates expected cash for a shift by summing completed cash transactions.
 */
export async function calculateExpectedCash(
  ownerId: string,
  clubId: string,
  shiftId: string,
  openingCash: number
): Promise<number> {
  const txSnap = await db
    .collection(COLLECTIONS.TRANSACTIONS(ownerId, clubId))
    .where("shiftId", "==", shiftId)
    .where("status", "==", "completed")
    .where("paymentMethod", "==", "cash")
    .get();

  const cashRevenue = txSnap.docs.reduce((sum, doc) => {
    return sum + (doc.data()["total"] as number);
  }, 0);

  return openingCash + cashRevenue;
}

export { ACCOUNT_CODES };
