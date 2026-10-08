import sharp from 'sharp';
import { processInspirationImage } from './image-processing';

async function image(width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg', withExif = false) {
  let pipeline = sharp({ create: { width, height, channels: 3, background: '#c08060' } });
  if (withExif) pipeline = pipeline.withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner' } } });
  return pipeline.toFormat(format).toBuffer();
}

describe('processInspirationImage', () => {
  it('resizes large images to a 1024px long edge and re-encodes as JPEG', async () => {
    const { jpeg, sha256 } = await processInspirationImage(await image(3000, 2000, 'png'));
    const meta = await sharp(jpeg).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width!, meta.height!)).toBe(1024);
    expect(sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('strips EXIF metadata', async () => {
    const input = await image(800, 800, 'jpeg', true);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const { jpeg } = await processInspirationImage(input);
    expect((await sharp(jpeg).metadata()).exif).toBeUndefined();
  });

  it('does not upscale small-but-valid images', async () => {
    const { jpeg } = await processInspirationImage(await image(400, 300, 'webp'));
    const meta = await sharp(jpeg).metadata();
    expect([meta.width, meta.height]).toEqual([400, 300]);
  });

  it('hashes the original bytes deterministically', async () => {
    const input = await image(500, 500);
    expect((await processInspirationImage(input)).sha256).toBe((await processInspirationImage(input)).sha256);
  });

  it('rejects tiny, corrupted, empty and non-image input', async () => {
    await expect(processInspirationImage(await image(100, 100))).rejects.toThrow(/کوچک/);
    await expect(processInspirationImage(Buffer.from('not an image at all'))).rejects.toThrow(/معتبر نیست/);
    await expect(processInspirationImage(Buffer.alloc(0))).rejects.toThrow(/مگابایت/);
    const truncated = (await image(800, 800)).subarray(0, 200);
    await expect(processInspirationImage(truncated)).rejects.toThrow();
  });

  it('rejects oversize uploads before decoding', async () => {
    await expect(processInspirationImage(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow(/مگابایت/);
  });
});
