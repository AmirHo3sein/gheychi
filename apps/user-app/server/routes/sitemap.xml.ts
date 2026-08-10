import { defineEventHandler, setHeader } from 'h3';
import { buildSitemapIndexPayload } from '../utils/sitemap-index';

// Preserves the URL robots.txt has always advertised (`Sitemap: /sitemap.xml`, see
// public/robots.txt) across the move to a multi-file sitemap: rather than redirecting,
// /sitemap.xml now IS the sitemap index -- identical content to /sitemap-index.xml, just
// kept live at its historical URL so nothing outside this app needs to change.
export default defineEventHandler(async (event) => {
  setHeader(event, 'content-type', 'application/xml; charset=utf-8');
  return buildSitemapIndexPayload();
});
