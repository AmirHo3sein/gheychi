import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

// The sitemap protocol hard-caps a single sitemap file at 50,000 URLs
// (https://www.sitemaps.org/protocol.html#index). This page size sits well under that --
// smaller files are friendlier to crawlers and cheaper to regenerate, and it leaves
// enormous headroom (250k+ rows per source) before this would ever need to shrink further.
// Shared by SitemapSalonsController and SitemapBlogController so both sources page the
// same way; the user-app's sitemap-index route derives page counts from each source's own
// `total`/`pageSize` response rather than hardcoding this value a second time.
export const SITEMAP_PAGE_SIZE = 5_000;

export class SitemapPageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

// A page past the real last page (stale crawler-cached URL, or the table shrank) must come
// back as a valid, empty page rather than a 404/500 -- callers just get items: []. skip/take
// beyond `total` naturally produces that with TypeORM's findAndCount, no special-casing needed.
export interface SitemapPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
