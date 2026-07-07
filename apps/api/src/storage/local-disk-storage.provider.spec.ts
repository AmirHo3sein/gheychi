import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalDiskStorageProvider } from './local-disk-storage.provider';

describe('LocalDiskStorageProvider', () => {
  let root: string;
  let provider: LocalDiskStorageProvider;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'arayeshgah-storage-test-'));
    provider = new LocalDiskStorageProvider('http://localhost:3002', root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('writes the buffer under the given key and returns a public URL', async () => {
    const url = await provider.upload(Buffer.from('fake-image-bytes'), 'salons/abc/photo.jpg', 'image/jpeg');
    expect(url).toBe('http://localhost:3002/uploads/salons/abc/photo.jpg');
    expect(existsSync(join(root, 'salons/abc/photo.jpg'))).toBe(true);
  });

  it('creates nested directories for the key as needed', async () => {
    await provider.upload(Buffer.from('x'), 'salons/new-salon-id/deep/photo.jpg', 'image/jpeg');
    expect(existsSync(join(root, 'salons/new-salon-id/deep/photo.jpg'))).toBe(true);
  });

  it('deletes the file for a given key', async () => {
    await provider.upload(Buffer.from('x'), 'salons/abc/photo.jpg', 'image/jpeg');
    await provider.delete('salons/abc/photo.jpg');
    expect(existsSync(join(root, 'salons/abc/photo.jpg'))).toBe(false);
  });

  it('does not throw when deleting a key that was never uploaded', async () => {
    await expect(provider.delete('salons/never/uploaded.jpg')).resolves.toBeUndefined();
  });
});
