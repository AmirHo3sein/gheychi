import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import sharp from 'sharp';

export const MAX_SERVICE_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;
export const SERVICE_IMAGE_CONTENT_TYPE = 'image/jpeg';
const MIN_DIMENSION = 200;
// Decompression-bomb guard: a tiny file can declare an enormous canvas. sharp refuses to
// decode past this many pixels (~40 MP, above any phone camera). Same bound as
// beauty-guide/image-processing.ts.
const MAX_INPUT_PIXELS = 40_000_000;
const OUTPUT_MAX_EDGE = 1200;
const INVALID_IMAGE_MESSAGE = 'فایل تصویر معتبر نیست یا آسیب دیده است';

/**
 * Normalizes a salon service's primary image before it is stored. Unlike portfolio/photo
 * uploads (stored byte-for-byte), a service image is always re-encoded: auto-rotated by
 * its EXIF orientation, capped at a 1200px long edge, flattened onto white (PNG/WebP
 * transparency) and written as JPEG -- which also drops every metadata block (EXIF,
 * including phone GPS). The stored Content-Type is therefore always image/jpeg, never
 * anything the client declared.
 *
 * The caller has already run the magic-number FileTypeValidator and
 * assertTrustedImageMimeType(); this is the decode-level check on top of them.
 */
export async function normalizeServiceImage(input: Buffer): Promise<Buffer> {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new UnprocessableEntityException(INVALID_IMAGE_MESSAGE);
  }
  if (!metadata.width || !metadata.height || metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION) {
    throw new BadRequestException('تصویر خیلی کوچک است؛ حداقل ابعاد ۲۰۰ در ۲۰۰ پیکسل است');
  }
  try {
    return await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: OUTPUT_MAX_EDGE, height: OUTPUT_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new UnprocessableEntityException(INVALID_IMAGE_MESSAGE);
  }
}
