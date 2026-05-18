import { describe, it, expect, vi } from "vitest";
import { classifyError, createCallableExecutor } from "./callable-executor";
import type { QueueItem } from "./queue.types";

// ── classifyError ─────────────────────────────────────────────────────────────

describe("classifyError", () => {
  it("classifies already-exists as duplicate", () => {
    expect(classifyError({ code: "functions/already-exists", message: "" })).toBe("duplicate");
  });

  it.each([
    "functions/invalid-argument",
    "functions/not-found",
    "functions/permission-denied",
    "functions/unauthenticated",
    "functions/failed-precondition",
    "functions/out-of-range",
    "functions/unimplemented",
  ])("classifies %s as terminal", (code) => {
    expect(classifyError({ code, message: "" })).toBe("terminal");
  });

  it.each([
    "functions/unavailable",
    "functions/deadline-exceeded",
    "functions/internal",
    "functions/resource-exhausted",
  ])("classifies %s as retryable", (code) => {
    expect(classifyError({ code, message: "" })).toBe("retryable");
  });

  it("classifies unknown Firebase code as retryable", () => {
    expect(classifyError({ code: "functions/unknown", message: "" })).toBe("retryable");
  });

  it("classifies non-Firebase error as retryable", () => {
    expect(classifyError(new Error("network error"))).toBe("retryable");
    expect(classifyError("string error")).toBe("retryable");
    expect(classifyError(null)).toBe("retryable");
  });
});

// ── createCallableExecutor ────────────────────────────────────────────────────

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: "item-1",
    operationId: "op-1",
    requestId: "req-1",
    functionName: "pos_completeTransaction",
    payload: {},
    attemptCount: 1,
    maxAttempts: 5,
    lastAttemptAt: undefined,
    nextRetryAt: undefined,
    status: "in_flight",
    errorMessage: undefined,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("createCallableExecutor", () => {
  it("resolves successfully when callFn succeeds", async () => {
    const callFn = vi.fn().mockResolvedValue({ data: "ok" });
    const executor = createCallableExecutor(callFn);
    const item = makeItem();

    await expect(executor(item)).resolves.toBeUndefined();
    expect(callFn).toHaveBeenCalledWith(item.functionName, item.payload);
  });

  it("resolves silently on duplicate (already-exists)", async () => {
    const callFn = vi.fn().mockRejectedValue({ code: "functions/already-exists", message: "" });
    const executor = createCallableExecutor(callFn);

    await expect(executor(makeItem())).resolves.toBeUndefined();
  });

  it("throws on retryable error without mutating maxAttempts", async () => {
    const callFn = vi.fn().mockRejectedValue({ code: "functions/unavailable", message: "" });
    const executor = createCallableExecutor(callFn);
    const item = makeItem({ maxAttempts: 5, attemptCount: 1 });

    await expect(executor(item)).rejects.toBeDefined();
    expect(item.maxAttempts).toBe(5); // unchanged
  });

  it("throws on terminal error and sets maxAttempts to force dead-letter", async () => {
    const callFn = vi.fn().mockRejectedValue({ code: "functions/permission-denied", message: "" });
    const executor = createCallableExecutor(callFn);
    const item = makeItem({ maxAttempts: 5, attemptCount: 2 });

    await expect(executor(item)).rejects.toBeDefined();
    // maxAttempts should equal attemptCount + 1 so markFailed dead-letters immediately
    expect(item.maxAttempts).toBe(3);
  });
});
