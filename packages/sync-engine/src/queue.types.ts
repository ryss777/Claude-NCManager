export type QueueItemStatus =
  | "pending"
  | "in_flight"
  | "succeeded"
  | "failed"
  | "dead_letter";

export interface QueueItem {
  id: string;
  operationId: string;
  requestId: string;
  functionName: string;
  payload: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  lastAttemptAt: string | undefined;
  nextRetryAt: string | undefined;
  status: QueueItemStatus;
  errorMessage: string | undefined;
  createdAt: string;
}

export type EnqueueParams = Pick<
  QueueItem,
  "operationId" | "requestId" | "functionName" | "payload"
> & {
  maxAttempts?: number;
};
