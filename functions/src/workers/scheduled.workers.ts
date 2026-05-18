import * as functions from "firebase-functions";

// Retry failed sync queue items every 1 minute
export const syncRetryWorker = functions.pubsub
  .schedule("every 1 minutes")
  .onRun(async () => {
    // TODO: Phase 6 — sync retry logic
  });

// Scan for stale devices every 5 minutes
export const staleDeviceScanner = functions.pubsub
  .schedule("every 5 minutes")
  .onRun(async () => {
    // TODO: Phase 6 — stale device detection
  });

// Daily analytics projection
export const dailyAnalyticsWorker = functions.pubsub
  .schedule("0 1 * * *")
  .timeZone("Asia/Jakarta")
  .onRun(async () => {
    // TODO: Phase 6 — analytics projection
  });

// Membership expiry check — daily
export const membershipExpiryWorker = functions.pubsub
  .schedule("0 0 * * *")
  .timeZone("Asia/Jakarta")
  .onRun(async () => {
    // TODO: Phase 6 — membership expiry
  });
