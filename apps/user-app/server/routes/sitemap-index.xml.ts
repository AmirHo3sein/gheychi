import { defineEventHandler, setHeader } from 'h3';
import { buildSitemapIndexPayload } from '../utils/sitemap-index';

// Lists the current sitemap-salons-N.xml / sitemap-posts-N.xml sub-sitemaps. See
// server/utils/sitemap-index.ts for how page counts are derived without ever fetching a
// full source list here.
export default defineEventHandler(async (event) => {
  setHeader(event, 'content-type', 'application/xml; charset=utf-8');
  return buildSitemapIndexPayload();
});
