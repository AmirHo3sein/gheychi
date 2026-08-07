import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { dirname, join, relative } from 'path';
import { StorageObjectInfo, StorageProvider } from './storage.provider';

@Injectable()
export class LocalDiskStorageProvider implements StorageProvider {
  constructor(
    private readonly publicBaseUrl: string,
    private readonly root: string = join(process.cwd(), 'uploads'),
  ) {}

  async upload(buffer: Buffer, key: string, contentType?: string): Promise<string> {
    const filePath = join(this.root, key);
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return this.publicUrl(key);
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl}/uploads/${key}`;
  }

  async delete(key: string): Promise<void> {
    await fs.rm(join(this.root, key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.stat(join(this.root, key));
      return true;
    } catch {
      return false;
    }
  }

  async list(prefix: string): Promise<StorageObjectInfo[]> {
    const dir = join(this.root, prefix);
    const results: StorageObjectInfo[] = [];
    await this.walk(dir, results);
    return results;
  }

  private async walk(dir: string, results: StorageObjectInfo[]): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // prefix directory doesn't exist yet -- nothing to list
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walk(fullPath, results);
      } else {
        const stat = await fs.stat(fullPath);
        results.push({ key: relative(this.root, fullPath).split('\\').join('/'), lastModified: stat.mtime });
      }
    }
  }
}
