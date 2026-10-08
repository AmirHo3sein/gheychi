import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { createHash } from 'crypto';
import sharp from 'sharp';

export const MAX_INSPIRATION_UPLOAD_BYTES = 5 * 1024 * 1024;
const MIN_DIMENSION = 200;
// Decompression-bomb guard: a tiny file can declare an enormous canvas. sharp refuses to
// decode past this many pixels (~40 MP, above any phone camera).
const MAX_INPUT_PIXELS = 40_000_000;
const OUTPUT_MAX_EDGE = 1024;
const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);

export interface ProcessedImage {
  jpeg: Buffer;
  /** Hash of the ORIGINAL upload bytes -- stable across re-uploads of the same file, used only for per-user dedupe. */
  sha256: string;
}

/**
 * Upload → validate → normalize, before anything is stored or sent to an AI provider.
 * Re-encoding through sharp drops all metadata by default (EXIF, including GPS location
 * from phone photos), auto-rotates by the EXIF orientation first so the stripped image
 * still looks upright, and caps the long edge at 1024 px so the provider never receives a
 * raw multi-megabyte camera file. Only the processed JPEG is ever persisted.
 */
export async function processInspirationImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0 || input.length > MAX_INSPIRATION_UPLOAD_BYTES) {
    throw new BadRequestException('حجم تصویر باید کمتر از ۵ مگابایت باشد');
  }
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
  } catch {
    throw new UnprocessableEntityException('فایل تصویر معتبر نیست یا آسیب دیده است');
  }
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new UnprocessableEntityException('فقط تصاویر JPEG، PNG یا WebP پذیرفته می‌شوند');
  }
  if (!metadata.width || !metadata.height || metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION) {
    throw new BadRequestException('تصویر خیلی کوچک است؛ لطفاً تصویری واضح‌تر انتخاب کنید');
  }

  let jpeg: Buffer;
  try {
    jpeg = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .resize({ width: OUTPUT_MAX_EDGE, height: OUTPUT_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();
  } catch {
    throw new UnprocessableEntityException('فایل تصویر معتبر نیست یا آسیب دیده است');
  }
  return { jpeg, sha256: createHash('sha256').update(input).digest('hex') };
}
