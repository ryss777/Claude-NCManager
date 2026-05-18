export type JournalEntryType =
  | "sale"
  | "reversal"
  | "expense"
  | "shift_close"
  | "adjustment"
  | "membership_payment"
  | "cash_in"
  | "cash_out";

export type AccountCode =
  | "1001" // Cash
  | "1002" // Member Balance
  | "4001" // Sales Revenue
  | "4002" // Membership Revenue
  | "5001" // COGS
  | "6001" // Operating Expense
  | "2001"; // Liability - Unearned

export interface JournalEntry {
  id: string;
  ownerId: string;
  clubId: string;
  entryType: JournalEntryType;
  amount: number;
  debitAccount: AccountCode;
  creditAccount: AccountCode;
  description: string;
  referenceId?: string;
  referenceType?: "transaction" | "shift" | "membership" | "manual";
  shiftId?: string;
  operatorId?: string;
  requestId: string;
  operationId: string;
  reversedEntryId?: string;
  createdAt: string;
}

export interface Shift {
  id: string;
  ownerId: string;
  clubId: string;
  operatorId: string;
  deviceId: string;
  openingCash: number;
  expectedCash?: number;
  actualCash?: number;
  cashDiscrepancy?: number;
  totalTransactions: number;
  totalRevenue: number;
  status: "open" | "closed";
  openedAt: string;
  closedAt?: string;
  notes?: string;
}

export interface FinanceSummary {
  date: string;
  totalRevenue: number;
  totalTransactions: number;
  totalReversals: number;
  cashRevenue: number;
  transferRevenue: number;
  membershipRevenue: number;
  netRevenue: number;
}
