/**
 * Storage abstraction so the queue can be backed by MMKV in production
 * and a plain Map in tests — no React Native dependency at the package level.
 */
export interface StorageAdapter {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
}

/**
 * In-memory adapter used in unit tests.
 */
export class MemoryStorageAdapter implements StorageAdapter {
  private store = new Map<string, string>();

  getString(key: string): string | undefined {
    return this.store.get(key);
  }

  set(key: string, value: string): void {
    this.store.set(key, value);
  }

  delete(key: string): void {
    this.store.delete(key);
  }
}

/**
 * Wraps react-native-mmkv MMKV instance to satisfy StorageAdapter.
 * Import and wire this in the app entry point.
 *
 * @example
 * import { MMKV } from 'react-native-mmkv';
 * const mmkv = new MMKV({ id: 'nc-sync-queue' });
 * const adapter = new MMKVStorageAdapter(mmkv);
 */
export class MMKVStorageAdapter implements StorageAdapter {
  constructor(
    private readonly mmkv: {
      getString(key: string): string | undefined;
      set(key: string, value: string): void;
      delete(key: string): void;
    }
  ) {}

  getString(key: string): string | undefined {
    return this.mmkv.getString(key);
  }

  set(key: string, value: string): void {
    this.mmkv.set(key, value);
  }

  delete(key: string): void {
    this.mmkv.delete(key);
  }
}
