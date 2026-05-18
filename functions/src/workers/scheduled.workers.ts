import { onSchedule } from "firebase-functions/v2/scheduler";

export const syncRetryWorker = onSchedule("every 1 minutes", async () => {
  // TODO: Phase 6 — sync retry logic
});

export const staleDeviceScanner = onSchedule("every 5 minutes", async () => {
  // TODO: Phase 6 — stale device detection
});

export const dailyAnalyticsWorker = onSchedule(
  { schedule: "0 1 * * *", timeZone: "Asia/Jakarta" },
  async () => {
    // TODO: Phase 6 — analytics projection
  }
);

export const membershipExpiryWorker = onSchedule(
  { schedule: "0 0 * * *", timeZone: "Asia/Jakarta" },
  async () => {
    // TODO: Phase 6 — membership expiry
  }
);
