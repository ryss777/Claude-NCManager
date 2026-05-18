export const RETRY_CONFIG = {
  INITIAL_DELAY_MS: 5_000,
  SECOND_DELAY_MS: 15_000,
  THIRD_DELAY_MS: 30_000,
  MAX_ATTEMPTS: 5,
  JITTER_MAX_MS: 2_000,
  DEAD_LETTER_AFTER_ATTEMPTS: 5,
} as const;

export const SYNC_INTERVALS = {
  RETRY_WORKER_MS: 60_000,
  STALE_DEVICE_SCANNER_MS: 300_000,
  ANALYTICS_WORKER_MS: 3_600_000,
} as const;

export const OFFLINE_QUEUE_KEY = "@nc-manager/sync-queue";
export const OPERATOR_SESSION_KEY = "@nc-manager/operator-session";
export const SHIFT_DRAFT_KEY = "@nc-manager/shift-draft";
