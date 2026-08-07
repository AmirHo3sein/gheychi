import { BadRequestException } from '@nestjs/common';

// The one set of image types this codebase accepts anywhere a user (salon owner or admin)
// uploads an image -- kept in exactly one place so the FileTypeValidator regex, the
// extension map, and the trusted-mimetype guard below can never independently drift.
export const ALLOWED_IMAGE_MIME_TYPE_PATTERN = /^image\/(jpeg|png|webp)$/;

export const EXTENSION_BY_IMAGE_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * NestJS's FileTypeValidator (used via ParseFilePipeBuilder at every upload call site)
 * sniffs the file's REAL bytes and rejects anything whose actual content doesn't match an
 * allowed image signature -- but it never rewrites `file.mimetype` itself, which stays
 * exactly whatever Content-Type the client declared on the multipart file part. Those are
 * two independent fields: a request can carry real, validator-passing JPEG bytes while
 * declaring `Content-Type: text/html` on the part. Every upload call site persists
 * `file.mimetype` as the stored object's Content-Type (S3StorageProvider forwards it
 * verbatim to S3) -- left unchecked, a crafted upload could get served back from S3/CDN
 * with `Content-Type: text/html` despite passing the magic-number check, i.e. stored XSS.
 * This closes that gap: `file.mimetype` must ALSO be exactly one of the same allowed
 * values, or the upload is rejected outright.
 */
export function assertTrustedImageMimeType(mimetype: string): void {
  if (!ALLOWED_IMAGE_MIME_TYPE_PATTERN.test(mimetype)) {
    throw new BadRequestException('Unsupported file type');
  }
}
