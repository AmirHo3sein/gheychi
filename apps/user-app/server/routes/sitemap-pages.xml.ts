import { defineEventHandler, setHeader } from 'h3';
import { buildStaticPageEntries, buildUrlsetXml } from '../utils/sitemap';

// The legal documents. Static, so no API call -- see STATIC_SITEMAP_PATHS.
export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'application/xml; charset=utf-8');
  const siteUrl = useRuntimeConfig().public.siteUrl;
  return buildUrlsetXml(buildStaticPageEntries(siteUrl));
});
