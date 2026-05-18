import { describe, it, expect, beforeEach, vi } from "vitest";
import { SyncQueue } from "./sync-queue";
import { MemoryStorageAdapter } from "./storage.adapter";

function makeQueue() {
  return new SyncQueue(new MemoryStorageAdapter());
}

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    operationId: "op-1",
    requestId: "req-1",
    functionName: "pos_completeTransaction",
    payload: { ownerId: "o1", clubId: "c1" },
    ...overrides,
  };
}

describe("SyncQueue.enqueue", () => {
  it("adds item to queue with status pending", () => {
    const q = makeQueue();
    const item = q.enqueue(makeParams());
    expect(item.status).toBe("pending");
    expect(item.attemptCount).toBe(0);
    expect(item.functionName).toBe("pos_completeTransaction");
  });

  it("is idempotent — same operationId returns existing item", () => {
    const q = makeQueue();
    const first = q.enqueue(makeParams());
    const second = q.enqueue(makeParams());
    expect(second.id).toBe(first.id);
    expect(q.getPendingCount()).toBe(1);
  });

  it("two different operationIds create two items", () => {
    const q = makeQueue();
    q.enqueue(makeParams({ operationId: "op-1" }));
    q.enqueue(makeParams({ operationId: "op-2" }));
    expect(q.getPendingCount()).toBe(2);
  });
});

describe("SyncQueue.getPendingDue", () => {
  it("returns item with no nextRetryAt", () => {
    const q = makeQueue();
    q.enqueue(makeParams());
    expect(q.getPendingDue()).toHaveLength(1);
  });

  it("does not return item with future nextRetryAt", () => {
    const q = makeQueue();
    const item = q.enqueue(makeParams());
    // Manually inject a future retry time via markFailed path
    q.markInFlight(item.id);
    q.markFailed(item.id, "transient error");
    // Item now has a nextRetryAt in the future
    expect(q.getPendingDue()).toHaveLength(0);
  });

  it("does not return in_flight items", () => {
    const q = makeQueue();
    const item = q.enqueue(makeParams());
    q.markInFlight(item.id);
    expect(q.getPendingDue()).toHaveLength(0);
  });
});

describe("SyncQueue.markInFlight / markSucceeded", () => {
  it("transitions to in_flight", () => {
    const q = makeQueue();
    const item = q.enqueue(makeParams());
    q.markInFlight(item.id);
    expect(q.getInFlight()).toHaveLength(1);
  });

  it("markSucceeded removes item from queue", () => {
    const q = makeQueue();
    const item = q.enqueue(makeParams());
    q.markInFlight(item.id);
    q.markSucceeded(item.id);
    expect(q.getPendingCount()).toBe(0);
    expect(q.getInFlight()).toHaveLength(0);
  });
});

describe("SyncQueue.markFailed", () => {
  it("increments attemptCount and stays pending", () => {
    const q = makeQueue();
    const item = q.enqueue(makeParams());
    q.markInFlight(item.id);
    q.markFailed(item.id, "network error");

    // Still pending (not dead yet — default maxAttempts = 5)
    const due = q.getPendingDue();
    expect(due).toHaveLength(0); // has future nextRetryAt
    expect(q.getPendingCount()).toBe(1);
  });

  it("moves to dead_letter after maxAttempts exhausted", () => {
    const q = makeQueue();
    const item = q.enqueue(makeParams({ maxAttempts: 2 }));

    for (let i = 0; i < 2; i++) {
      q.markInFlight(item.id);
      q.markFailed(item.id, "error");
    }

    expect(q.getDeadLetters()).toHaveLength(1);
    expect(q.getPendingCount()).toBe(0);
  });

  it("stores errorMessage", () => {
    const q = makeQueue();
    const item = q.enqueue(makeParams({ maxAttempts: 1 }));
    q.markInFlight(item.id);
    q.markFailed(item.id, "permission-denied");

    const dead = q.getDeadLetters()[0];
    expect(dead?.errorMessage).toBe("permission-denied");
  });
});

describe("SyncQueue.recoverInFlight", () => {
  it("resets in_flight items back to pending", () => {
    const q = makeQueue();
    const item = q.enqueue(makeParams());
    q.markInFlight(item.id);
    expect(q.getInFlight()).toHaveLength(1);

    const recovered = q.recoverInFlight();
    expect(recovered).toBe(1);
    expect(q.getInFlight()).toHaveLength(0);
    expect(q.getPendingDue()).toHaveLength(1);
  });

  it("returns 0 when no in_flight items", () => {
    const q = makeQueue();
    q.enqueue(makeParams());
    expect(q.recoverInFlight()).toBe(0);
  });
});

describe("SyncQueue.prune", () => {
  it("removes dead_letter items older than maxAge", () => {
    const q = makeQueue();
    const item = q.enqueue(makeParams({ maxAttempts: 1 }));
    q.markInFlight(item.id);
    q.markFailed(item.id, "terminal");

    expect(q.getDeadLetters()).toHaveLength(1);

    // Prune with 0ms maxAge — everything is "old"
    q.prune(0);
    expect(q.getDeadLetters()).toHaveLength(0);
  });

  it("keeps pending items regardless of age", () => {
    const q = makeQueue();
    q.enqueue(makeParams());
    q.prune(0);
    expect(q.getPendingCount()).toBe(1);
  });
});
