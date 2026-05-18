export type EventType =
  | "transaction.created"
  | "transaction.making"
  | "transaction.completed"
  | "transaction.reversed"
  | "shift.opened"
  | "shift.closed"
  | "inventory.movement"
  | "membership.activated"
  | "membership.visit_deducted"
  | "membership.expired"
  | "device.registered"
  | "device.deactivated"
  | "sync.conflict_detected"
  | "sync.reconciled";

export interface DomainEvent {
  id: string;
  ownerId: string;
  clubId: string;
  eventType: EventType;
  aggregateId: string;
  aggregateType: string;
  payload: Record<string, unknown>;
  requestId: string;
  operationId: string;
  producedBy: string;
  processedBy?: string[];
  schemaVersion: number;
  createdAt: string;
}

export interface SyncQueueItem {
  id: string;
  operationId: string;
  requestId: string;
  functionName: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt?: string;
  nextRetryAt?: string;
  status: "pending" | "in_flight" | "succeeded" | "failed" | "dead_letter";
  errorMessage?: string;
  createdAt: string;
}
