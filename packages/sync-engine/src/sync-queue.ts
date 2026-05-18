import { OFFLINE_QUEUE_KEY, RETRY_CONFIG } from "@nc-manager/shared-constants";
import type { StorageAdapter } from "./storage.adapter";
import type { QueueItem, EnqueueParams, QueueItemStatus } from "./queue.types";

/**
 * Persistent sync queue backed by a StorageAdapter (MMKV in production).
 * All state is serialised as JSON under a single MMKV key so reads are O(1)
 * and the queue survives process restarts.
 */
export class SyncQueue {
  private readonly storageKey: string;

  constructor(
    private readonly storage: StorageAdapter,
    storageKey = OFFLINE_QUEUE_KEY
  ) {
    this.storageKey = storageKey;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private readAll(): QueueItem[] {
    const raw = this.storage.getString(this.storageKey);
    if (!raw) return [];
    try {
      return JSON.parse(raw) as QueueItem[];
    } catch {
      return [];
    }
  }

  private writeAll(items: QueueItem[]): void {
    this.storage.set(this.storageKey, JSON.stringify(items));
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Adds a new operation to the tail of the queue.
   * If an item with the same operationId already exists, returns it unchanged
   * (idempotent enqueue).
   */
  enqueue(params: EnqueueParams): QueueItem {
    const items = this.readAll();
    const existing = items.find((i) => i.operationId === params.operationId);
    if (existing) return existing;

    const item: QueueItem = {
      id: this.generateId(),
      operationId: params.operationId,
      requestId: params.requestId,
      functionName: params.functionName,
      payload: params.payload,
      attemptCount: 0,
      maxAttempts: params.maxAttempts ?? RETRY_CONFIG.MAX_ATTEMPTS,
      lastAttemptAt: undefined,
      nextRetryAt: undefined,
      status: "pending",
      errorMessage: undefined,
      createdAt: new Date().toISOString(),
    };

    this.writeAll([...items, item]);
    return item;
  }

  /**
   * Returns all items whose nextRetryAt is in the past (or unset) and status
   * is pending — these are ready to be executed.
   */
  getPendingDue(): QueueItem[] {
    const now = Date.now();
    return this.readAll().filter((item) => {
      if (item.status !== "pending") return false;
      if (!item.nextRetryAt) return true;
      return new Date(item.nextRetryAt).getTime() <= now;
    });
  }

  /**
   * Returns items with status in_flight. Used on startup for crash recovery.
   */
  getInFlight(): QueueItem[] {
    return this.readAll().filter((i) => i.status === "in_flight");
  }

  /** Returns all items in dead_letter state. */
  getDeadLetters(): QueueItem[] {
    return this.readAll().filter((i) => i.status === "dead_letter");
  }

  /** Returns queue depth (all non-terminal items). */
  getPendingCount(): number {
    return this.readAll().filter((i) => i.status === "pending" || i.status === "in_flight")
      .length;
  }

  /**
   * Marks an item as in_flight before executing — prevents double-execution
   * if the retry loop ticks again while a request is in-progress.
   */
  markInFlight(id: string): void {
    this.updateItem(id, { status: "in_flight", lastAttemptAt: new Date().toISOString() });
  }

  /**
   * Marks an item as succeeded and removes it from the queue.
   */
  markSucceeded(id: string): void {
    const items = this.readAll().filter((i) => i.id !== id);
    this.writeAll(items);
  }

  /**
   * Records a failure. Increments attemptCount, calculates nextRetryAt,
   * and moves to dead_letter if max attempts reached.
   */
  markFailed(id: string, errorMessage: string): void {
    this.updateItem(id, (item) => {
      const attemptCount = item.attemptCount + 1;
      const isDead = attemptCount >= item.maxAttempts;

      return {
        status: isDead ? "dead_letter" : "pending",
        attemptCount,
        errorMessage,
        lastAttemptAt: new Date().toISOString(),
        nextRetryAt: isDead ? undefined : calculateNextRetry(attemptCount),
      };
    });
  }

  /**
   * On crash recovery: reset all in_flight items back to pending so they
   * are retried on the next scheduler tick.
   */
  recoverInFlight(): number {
    const items = this.readAll();
    let recovered = 0;

    const updated = items.map((item) => {
      if (item.status !== "in_flight") return item;
      recovered++;
      return { ...item, status: "pending" as QueueItemStatus, nextRetryAt: undefined };
    });

    if (recovered > 0) this.writeAll(updated);
    return recovered;
  }

  /**
   * Removes all succeeded and dead_letter items older than maxAgeMs.
   */
  prune(maxAgeMs = 7 * 24 * 60 * 60 * 1000): void {
    const cutoff = Date.now() - maxAgeMs;
    const items = this.readAll().filter((item) => {
      if (item.status === "pending" || item.status === "in_flight") return true;
      return new Date(item.createdAt).getTime() > cutoff;
    });
    this.writeAll(items);
  }

  /** Clears the entire queue — for testing / hard reset only. */
  clear(): void {
    this.storage.delete(this.storageKey);
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private updateItem(
    id: string,
    patch: Partial<QueueItem> | ((item: QueueItem) => Partial<QueueItem>)
  ): void {
    const items = this.readAll().map((item) => {
      if (item.id !== id) return item;
      const delta = typeof patch === "function" ? patch(item) : patch;
      return { ...item, ...delta };
    });
    this.writeAll(items);
  }
}

// ── Backoff calculator ────────────────────────────────────────────────────────

function calculateNextRetry(attemptCount: number): string {
  const { INITIAL_DELAY_MS, SECOND_DELAY_MS, THIRD_DELAY_MS, JITTER_MAX_MS } = RETRY_CONFIG;

  let delayMs: number;
  if (attemptCount === 1) delayMs = INITIAL_DELAY_MS;
  else if (attemptCount === 2) delayMs = SECOND_DELAY_MS;
  else if (attemptCount === 3) delayMs = THIRD_DELAY_MS;
  else delayMs = THIRD_DELAY_MS * Math.pow(2, attemptCount - 3);

  const jitter = Math.random() * JITTER_MAX_MS;
  return new Date(Date.now() + delayMs + jitter).toISOString();
}
