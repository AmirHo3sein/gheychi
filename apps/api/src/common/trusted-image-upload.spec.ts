import { BadRequestException } from '@nestjs/common';
import { ALLOWED_IMAGE_MIME_TYPE_PATTERN, assertTrustedImageMimeType, EXTENSION_BY_IMAGE_MIME_TYPE } from './trusted-image-upload';

describe('trusted-image-upload', () => {
  describe('assertTrustedImageMimeType', () => {
    it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s', (mimetype) => {
      expect(() => assertTrustedImageMimeType(mimetype)).not.toThrow();
    });

    it('rejects a disallowed mimetype even when it would sound plausible', () => {
      expect(() => assertTrustedImageMimeType('image/gif')).toThrow(BadRequestException);
      expect(() => assertTrustedImageMimeType('image/svg+xml')).toThrow(BadRequestException);
    });

    it('rejects the exact spoofing vector this guard exists for: real image bytes declared as text/html', () => {
      // This is the concrete exploit: NestJS's FileTypeValidator only sniffs the file's
      // real bytes and never rewrites file.mimetype, so a request can carry validator-
      // passing image content while still declaring an attacker-chosen Content-Type here.
      expect(() => assertTrustedImageMimeType('text/html')).toThrow(BadRequestException);
    });

    it('rejects an empty or malformed mimetype string', () => {
      expect(() => assertTrustedImageMimeType('')).toThrow(BadRequestException);
      expect(() => assertTrustedImageMimeType('image/')).toThrow(BadRequestException);
      expect(() => assertTrustedImageMimeType('IMAGE/JPEG')).toThrow(BadRequestException); // case-sensitive, matches Multer's own lowercase convention
    });
  });

  it('EXTENSION_BY_IMAGE_MIME_TYPE covers exactly the same 3 types ALLOWED_IMAGE_MIME_TYPE_PATTERN allows', () => {
    for (const mimetype of Object.keys(EXTENSION_BY_IMAGE_MIME_TYPE)) {
      expect(ALLOWED_IMAGE_MIME_TYPE_PATTERN.test(mimetype)).toBe(true);
    }
    expect(Object.keys(EXTENSION_BY_IMAGE_MIME_TYPE).sort()).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });
});
