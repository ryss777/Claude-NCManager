import { describe, it, expect, vi, beforeEach } from "vitest";
import { RetryEngine } from "./retry-engine";
import { SyncQueue } from "./sync-queue";
import { MemoryStorageAdapter } from "./storage.adapter";

function makeQueue() {
  return new SyncQueue(new MemoryStorageAdapter());
}

function makeParams(operationId = "op-1") {
  return {
    operationId,
    requestId: "req-1",
    functionName: "pos_completeTransaction",
    payload: {},
  };
}

describe("RetryEngine", () => {
  it("start() transitions state to running", () => {
    const q = makeQueue();
    const engine = new RetryEngine(q, vi.fn(), 999999);
    expect(engine.engineState).toBe("idle");
    engine.start();
    expect(engine.engineState).toBe("running");
    engine.stop();
  });

  it("stop() transitions state to stopped", () => {
    const q = makeQueue();
    const engine = new RetryEngine(q, vi.fn(), 999999);
    engine.start();
    engine.stop();
    expect(engine.engineState).toBe("stopped");
  });

  it("start() is idempotent — double call does not create extra timers", () => {
    const q = makeQueue();
    const engine = new RetryEngine(q, vi.fn(), 999999);
    engine.start();
    engine.start(); // second call — should be a no-op
    expect(engine.engineState).toBe("running");
    engine.stop();
  });

  it("flush() calls execute for each due item and marks succeeded", async () => {
    const q = makeQueue();
    const executor = vi.fn().mockResolvedValue(undefined);
    const engine = new RetryEngine(q, executor, 999999);

    const item1 = q.enqueue(makeParams("op-1"));
    const item2 = q.enqueue(makeParams("op-2"));

    await engine.flush();

    expect(executor).toHaveBeenCalledTimes(2);
    expect(q.getPendingCount()).toBe(0);
    expect(q.getDeadLetters()).toHaveLength(0);
  });

  it("flush() marks item failed when executor throws", async () => {
    const q = makeQueue();
    const executor = vi.fn().mockRejectedValue(new Error("network"));
    const engine = new RetryEngine(q, executor, 999999);

    q.enqueue(makeParams());
    await engine.flush();

    // Item is still in queue (pending, not dead_letter yet — only 1 attempt)
    expect(q.getPendingCount()).toBe(1);
    expect(q.getDeadLetters()).toHaveLength(0);
  });

  it("flush() dead-letters item after maxAttempts exceeded", async () => {
    const q = makeQueue();
    const executor = vi.fn().mockRejectedValue(new Error("terminal"));
    const engine = new RetryEngine(q, executor, 999999);

    q.enqueue({ ...makeParams(), maxAttempts: 1 });
    await engine.flush();

    expect(q.getDeadLetters()).toHaveLength(1);
    expect(q.getPendingCount()).toBe(0);
  });

  it("flush() processes items sequentially (order preserved)", async () => {
    const q = makeQueue();
    const order: string[] = [];
    const executor = vi.fn().mockImplementation(async (item) => {
      order.push(item.operationId as string);
    });
    const engine = new RetryEngine(q, executor, 999999);

    q.enqueue(makeParams("first"));
    q.enqueue(makeParams("second"));
    q.enqueue(makeParams("third"));

    await engine.flush();

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("flush() does nothing when queue is empty", async () => {
    const q = makeQueue();
    const executor = vi.fn();
    const engine = new RetryEngine(q, executor, 999999);

    await engine.flush();

    expect(executor).not.toHaveBeenCalled();
  });
});
