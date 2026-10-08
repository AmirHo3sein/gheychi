import { promises as fs } from 'fs';
import { dirname, join, resolve, sep } from 'path';

export const PRIVATE_IMAGE_STORE = 'PRIVATE_IMAGE_STORE';

/**
 * Storage for images that must NEVER be publicly reachable (customer inspiration photos).
 *
 * Deliberately separate from StorageProvider: that interface is public-by-construction
 * (`upload()` returns a URL), and in local mode everything under `uploads/` is served
 * without auth by `useStaticAssets` (main.ts). This store has no URL concept at all --
 * bytes come back only through `get()`, which only authenticated, ownership-checked
 * endpoints call. It also lives outside StorageReconciliationJob (which would delete
 * unknown keys under `salons/`) and outside the backup mirror (whose missing `--remove`
 * would keep a deleted private image forever).
 */
export interface PrivateImageStore {
  put(key: string, buffer: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

// Keys are always server-generated (`beauty-guides/<uuid>/<uuid>.jpg`), but the store still
// refuses anything else -- a traversal-proof boundary that doesn't depend on every caller.
const KEY_PATTERN = /^[a-z0-9-]+(\/[a-z0-9-]+)*\.jpg$/;

export class LocalPrivateImageStore implements PrivateImageStore {
  private readonly root: string;

  constructor(rootDir: string) {
    this.root = resolve(rootDir);
  }

  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error('Invalid private image key');
    const full = resolve(join(this.root, key));
    if (!full.startsWith(this.root + sep)) throw new Error('Invalid private image key');
    return full;
  }

  async put(key: string, buffer: Buffer): Promise<void> {
    const path = this.pathFor(key);
    await fs.mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await fs.writeFile(path, buffer, { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await fs.readFile(this.pathFor(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await fs.rm(this.pathFor(key), { force: true });
  }
}
