import { IsString, Length, Matches } from 'class-validator';

export class UpdateHandleDto {
  // Lowercase letters/digits/single hyphens only, no leading/trailing hyphen, no doubled
  // hyphen -- same shape discipline as makeSlug()'s own generated slugs, but a provider can
  // now choose a clean, memorable one instead of always carrying an opaque random suffix.
  @IsString()
  @Length(3, 40)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message: 'آدرس فقط می‌تواند شامل حروف انگلیسی کوچک، عدد و خط تیره باشد (بدون خط تیره در ابتدا/انتها یا پشت‌سرهم)',
  })
  handle: string;
}
