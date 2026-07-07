import { Injectable } from '@nestjs/common';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { StorageProvider } from './storage.provider';

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
    return `${this.publicBaseUrl}/uploads/${key}`;
  }

  async delete(key: string): Promise<void> {
    await fs.rm(join(this.root, key), { force: true });
  }
}
