export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

export interface StorageObjectInfo {
  key: string;
  lastModified: Date;
}

export interface StorageProvider {
  upload(buffer: Buffer, key: string, contentType: string): Promise<string>;
  delete(key: string): Promise<void>;
  /**
   * Derives the public URL for an already-stored key -- always the exact string
   * upload() returned for that key (upload delegates to this), so callers that
   * persist only the key (blog covers) expose the same URL as callers that
   * persist upload()'s return value (salon photos).
   */
  publicUrl(key: string): string;
  /**
   * True if an object exists at `key` -- used by StorageReconciliationJob to find a
   * DB row whose backing object went missing. Never used to gate a normal read/write.
   */
  exists(key: string): Promise<boolean>;
  /** Every object whose key starts with `prefix`, for orphan detection. */
  list(prefix: string): Promise<StorageObjectInfo[]>;
}
