export type TransactionStatus =
  | "pending"
  | "making"
  | "completed"
  | "reversed";

export type PaymentMethod = "cash" | "transfer" | "member_balance";

export interface TransactionItem {
  productId: string;
  productName: string;
  variantId?: string;
  variantName?: string;
  modifierIds: string[];
  modifierNames: string[];
  quantity: number;
  unitPrice: number;
  subtotal: number;
}

export interface Transaction {
  id: string;
  ownerId: string;
  clubId: string;
  operatorId: string;
  deviceId: string;
  shiftId: string;
  customerId?: string;
  customerName?: string;
  membershipId?: string;
  items: TransactionItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: PaymentMethod;
  amountPaid: number;
  change: number;
  status: TransactionStatus;
  requestId: string;
  operationId: string;
  reversalReason?: string;
  reversedTransactionId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CreateTransactionPayload {
  requestId: string;
  operationId: string;
  ownerId: string;
  clubId: string;
  shiftId: string;
  items: TransactionItem[];
  paymentMethod: PaymentMethod;
  amountPaid: number;
  customerId?: string;
  membershipId?: string;
  discount?: number;
}
