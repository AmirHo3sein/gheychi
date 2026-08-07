import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalDiskStorageProvider } from './local-disk-storage.provider';

describe('LocalDiskStorageProvider', () => {
  let root: string;
  let provider: LocalDiskStorageProvider;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gheychi-storage-test-'));
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

  it('derives the same public URL from a bare key that upload() returned for it', async () => {
    const uploaded = await provider.upload(Buffer.from('x'), 'blog/post-1/cover.jpg', 'image/jpeg');
    expect(provider.publicUrl('blog/post-1/cover.jpg')).toBe(uploaded);
    expect(provider.publicUrl('blog/post-1/cover.jpg')).toBe('http://localhost:3002/uploads/blog/post-1/cover.jpg');
  });

  it('deletes the file for a given key', async () => {
    await provider.upload(Buffer.from('x'), 'salons/abc/photo.jpg', 'image/jpeg');
    await provider.delete('salons/abc/photo.jpg');
    expect(existsSync(join(root, 'salons/abc/photo.jpg'))).toBe(false);
  });

  it('does not throw when deleting a key that was never uploaded', async () => {
    await expect(provider.delete('salons/never/uploaded.jpg')).resolves.toBeUndefined();
  });

  describe('exists', () => {
    it('is true for an uploaded key and false for one that was never written', async () => {
      await provider.upload(Buffer.from('x'), 'salons/abc/photo.jpg', 'image/jpeg');
      await expect(provider.exists('salons/abc/photo.jpg')).resolves.toBe(true);
      await expect(provider.exists('salons/never/uploaded.jpg')).resolves.toBe(false);
    });
  });

  describe('list', () => {
    it('recursively lists every object under a prefix, with each key relative to the root', async () => {
      await provider.upload(Buffer.from('x'), 'salons/a/photo.jpg', 'image/jpeg');
      await provider.upload(Buffer.from('x'), 'salons/a/stories/story.jpg', 'image/jpeg');
      await provider.upload(Buffer.from('x'), 'blog/post-1/cover.jpg', 'image/jpeg');

      const salonObjects = await provider.list('salons/');

      expect(salonObjects.map((o) => o.key).sort()).toEqual(['salons/a/photo.jpg', 'salons/a/stories/story.jpg']);
      // Not toBeInstanceOf(Date): fs.Stats.mtime can come back from a different Date
      // realm than this test file's under ts-jest, which fails a strict instanceof
      // check despite being a genuine, valid Date value.
      expect(Object.prototype.toString.call(salonObjects[0]!.lastModified)).toBe('[object Date]');
      expect(salonObjects[0]!.lastModified.getTime()).toBeGreaterThan(0);
    });

    it('returns an empty array for a prefix with no objects yet, instead of throwing', async () => {
      await expect(provider.list('salons/')).resolves.toEqual([]);
    });
  });
});
