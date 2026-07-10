export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

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
}
