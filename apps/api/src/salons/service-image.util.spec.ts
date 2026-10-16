import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import sharp from 'sharp';
import { MAX_SERVICE_IMAGE_UPLOAD_BYTES, normalizeServiceImage } from './service-image.util';

async function image(width: number, height: number, format: 'jpeg' | 'png' | 'webp' = 'jpeg', withExif = false) {
  let pipeline = sharp({ create: { width, height, channels: 3, background: '#c08060' } });
  if (withExif) pipeline = pipeline.withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-owner' } } });
  return pipeline.toFormat(format).toBuffer();
}

describe('normalizeServiceImage', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('re-encodes a %s upload as JPEG', async (format) => {
    const out = await normalizeServiceImage(await image(600, 400, format));
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe('jpeg');
    expect([meta.width, meta.height]).toEqual([600, 400]);
  });

  it('caps the long edge at 1200px, preserving aspect ratio', async () => {
    const out = await normalizeServiceImage(await image(3000, 1500, 'png'));
    const meta = await sharp(out).metadata();
    expect([meta.width, meta.height]).toEqual([1200, 600]);
  });

  it('strips EXIF metadata', async () => {
    const input = await image(800, 800, 'jpeg', true);
    expect((await sharp(input).metadata()).exif).toBeDefined();
    const out = await normalizeServiceImage(input);
    expect((await sharp(out).metadata()).exif).toBeUndefined();
  });

  it('strips GPS EXIF, XMP and ICC from the output', async () => {
    const input = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#808080' } })
      .withExif({ IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 41/1 0/1' } } as never)
      .withXmp('<x:xmpmeta xmlns:x="adobe:ns:meta/"></x:xmpmeta>')
      .jpeg()
      .toBuffer();
    // Precondition: the input really carries a GPS IFD pointer (tag 0x8825, little-endian).
    expect((await sharp(input).metadata()).exif!.includes(Buffer.from([0x25, 0x88]))).toBe(true);
    const meta = await sharp(await normalizeServiceImage(input)).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.icc).toBeUndefined();
  });

  it('converts a CMYK JPEG to 3-channel sRGB', async () => {
    const cmyk = await sharp({ create: { width: 400, height: 400, channels: 3, background: '#ff0000' } })
      .toColourspace('cmyk')
      .jpeg()
      .toBuffer();
    expect((await sharp(cmyk).metadata()).space).toBe('cmyk');
    const meta = await sharp(await normalizeServiceImage(cmyk)).metadata();
    expect([meta.space, meta.channels]).toEqual(['srgb', 3]);
  });

  it.each(['webp', 'gif'] as const)('reduces an animated %s to its first frame as a still JPEG', async (format) => {
    const frame = (c: string) => sharp({ create: { width: 300, height: 300, channels: 3, background: c } }).png().toBuffer();
    const animated = await sharp([await frame('#ff0000'), await frame('#00ff00'), await frame('#0000ff')], { join: { animated: true } } as never)
      .toFormat(format, { loop: 0, delay: [100, 100, 100] } as never)
      .toBuffer();
    expect((await sharp(animated).metadata()).pages).toBe(3);
    const meta = await sharp(await normalizeServiceImage(animated)).metadata();
    expect([meta.format, meta.width, meta.height, meta.pages]).toEqual(['jpeg', 300, 300, undefined]);
  });

  it('refuses a decompression bomb (tiny file, >40 MP canvas) with 422', async () => {
    const bomb = await sharp({ create: { width: 10000, height: 10000, channels: 3, background: '#000' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(MAX_SERVICE_IMAGE_UPLOAD_BYTES);
    await expect(normalizeServiceImage(bomb)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('flattens transparency onto white', async () => {
    const transparent = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .png()
      .toBuffer();
    const out = await normalizeServiceImage(transparent);
    const { data } = await sharp(out).raw().toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(240);
    expect((await sharp(out).metadata()).hasAlpha).toBe(false);
  });

  it('rejects an image under 200px on either side with 400', async () => {
    await expect(normalizeServiceImage(await image(199, 800))).rejects.toBeInstanceOf(BadRequestException);
    await expect(normalizeServiceImage(await image(800, 150))).rejects.toThrow(/کوچک/);
  });

  it('rejects garbage and truncated input with 422', async () => {
    await expect(normalizeServiceImage(Buffer.from('not an image at all'))).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(normalizeServiceImage(Buffer.alloc(0))).rejects.toBeInstanceOf(UnprocessableEntityException);
    const truncated = (await image(800, 800)).subarray(0, 200);
    await expect(normalizeServiceImage(truncated)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
