import { defineEventHandler, setHeader } from 'h3';
import { buildRobotsTxt } from '../utils/robots';

// robots.txt is served from a route rather than public/ because its `Sitemap:` directive has
// to be an absolute url built from NUXT_PUBLIC_SITE_URL -- see server/utils/robots.ts for the
// full reasoning, and note that the old public/robots.txt had to be DELETED for this route to
// ever run (Nitro resolves public assets before server routes).
export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'text/plain; charset=utf-8');
  const config = useRuntimeConfig();
  return buildRobotsTxt(config.public.siteUrl);
});
