import { SYNC_INTERVALS } from "@nc-manager/shared-constants";
import type { SyncQueue } from "./sync-queue";
import type { QueueItem } from "./queue.types";

export type ExecuteFn = (item: QueueItem) => Promise<void>;

export type RetryEngineState = "idle" | "running" | "stopped";

/**
 * Drives the sync queue: polls for due items, executes them via ExecuteFn,
 * marks success or failure, and schedules retries using the SyncQueue backoff.
 *
 * Usage:
 *   const engine = new RetryEngine(queue, executor);
 *   engine.start();          // begin ticking
 *   engine.stop();           // pause (e.g. app background)
 *   await engine.flush();    // drain once (e.g. foreground restore)
 */
export class RetryEngine {
  private state: RetryEngineState = "idle";
  private timer: ReturnType<typeof setTimeout> | undefined = undefined;

  constructor(
    private readonly queue: SyncQueue,
    private readonly execute: ExecuteFn,
    private readonly intervalMs: number = SYNC_INTERVALS.RETRY_WORKER_MS
  ) {}

  get engineState(): RetryEngineState {
    return this.state;
  }

  /**
   * Starts the periodic retry loop.
   * Safe to call multiple times — ignores if already running.
   */
  start(): void {
    if (this.state === "running") return;
    this.state = "running";
    this.scheduleNextTick();
  }

  /**
   * Stops the retry loop. In-flight operations are not cancelled —
   * they will be recovered as pending on the next start().
   */
  stop(): void {
    this.state = "stopped";
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Executes all currently-due items immediately, without affecting the timer.
   * Useful when the app returns to foreground or network reconnects.
   */
  async flush(): Promise<void> {
    await this.processDueItems();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private scheduleNextTick(): void {
    if (this.state !== "running") return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.intervalMs);
  }

  private async tick(): Promise<void> {
    if (this.state !== "running") return;
    try {
      await this.processDueItems();
    } finally {
      this.scheduleNextTick();
    }
  }

  private async processDueItems(): Promise<void> {
    const due = this.queue.getPendingDue();
    if (due.length === 0) return;

    // Process items sequentially — preserves order within a session
    for (const item of due) {
      await this.processOne(item);
    }
  }

  private async processOne(item: QueueItem): Promise<void> {
    this.queue.markInFlight(item.id);
    try {
      await this.execute(item);
      this.queue.markSucceeded(item.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.queue.markFailed(item.id, message);
    }
  }
}
