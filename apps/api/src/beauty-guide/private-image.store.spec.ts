import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalPrivateImageStore } from './private-image.store';

describe('LocalPrivateImageStore', () => {
  let dir: string;
  let store: LocalPrivateImageStore;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'private-store-'));
    store = new LocalPrivateImageStore(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('round-trips, then deletes', async () => {
    await store.put('beauty-guides/u1/a1.jpg', Buffer.from('img'));
    expect((await store.get('beauty-guides/u1/a1.jpg'))?.toString()).toBe('img');
    await store.delete('beauty-guides/u1/a1.jpg');
    expect(await store.get('beauty-guides/u1/a1.jpg')).toBeNull();
  });

  it('returns null for a missing key and tolerates deleting one', async () => {
    expect(await store.get('beauty-guides/u1/missing.jpg')).toBeNull();
    await expect(store.delete('beauty-guides/u1/missing.jpg')).resolves.toBeUndefined();
  });

  it.each(['../escape.jpg', 'beauty-guides/../../etc/passwd.jpg', '/abs/path.jpg', 'beauty-guides/u1/a.png', 'Beauty/A.jpg'])(
    'refuses unsafe key %s',
    async (key) => {
      await expect(store.put(key, Buffer.from('x'))).rejects.toThrow('Invalid private image key');
    },
  );
});
