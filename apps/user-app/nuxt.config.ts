import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { MAX_SITEMAP_PAGES } from './server/utils/sitemap'

/**
 * The plugin-array type Nuxt itself expects, derived from its own config signature rather
 * than imported from 'vite' -- `vite` is not a direct dependency of this workspace, and
 * adding it would risk pinning a third copy of the very package this works around.
 */
type NuxtVitePlugins = NonNullable<NonNullable<Parameters<typeof defineNuxtConfig>[0]['vite']>['plugins']>

// The sitemap-salons-N.xml / sitemap-posts-N.xml sub-sitemaps (see server/handlers/) can't
// be a single file-based dynamic route (`server/routes/sitemap-salons-[page].xml.ts`):
// verified empirically that h3's router (rou3) only matches a `:param` segment when it's the
// *entire* path segment, not embedded alongside literal text -- a `[page]` bracket file
// named `sitemap-salons-[page].xml.ts` resolves to the route pattern
// `/sitemap-salons-:page.xml`, which rou3 silently never matches against a real request like
// `/sitemap-salons-1.xml` (it falls through to Nuxt's page renderer instead, with no error).
// @nuxtjs/sitemap's own chunking support hits this exact wall and works around it the same
// way: pre-register a bounded range of *static* routes at startup, all pointing at one
// shared handler that recovers the page number by parsing the request path itself
// (parsePageFromSitemapPath in server/utils/sitemap.ts) rather than relying on a route param.
const sitemapSalonsHandler = fileURLToPath(new URL('./server/handlers/sitemap-salons-page.ts', import.meta.url))
const sitemapPostsHandler = fileURLToPath(new URL('./server/handlers/sitemap-posts-page.ts', import.meta.url))

export default defineNuxtConfig({
  compatibilityDate: '2026-07-05',
  // Needed so composables like `navigateTo` still resolve the Nuxt app instance after
  // resuming from an `await` inside a nested async composable (e.g. useApi's 401 handler
  // called from auth.global.ts) -- without this, Node's default context loses track of
  // the app across the microtask boundary and throws "useNuxtApp called outside of a
  // plugin/hook/setup function".
  experimental: { asyncContext: true },
  modules: ['@pinia/nuxt', '@nuxt/test-utils/module', '@nuxt/image', '@vite-pwa/nuxt'],
  css: ['~/assets/css/main.css'],
  // Nested components/<dir>/*.vue would otherwise auto-register with a directory-name
  // prefix (e.g. <LayoutAppHeader>); disabling it lets AppHeader/ThemeToggle/ToastStack
  // resolve under their own component names as used throughout templates.
  components: [{ path: '~/components', pathPrefix: false }],
  image: {
    providers: {
      arvancloud: {
        name: 'arvancloud',
        provider: '~/providers/arvancloud.ts',
      },
    },
  },
  vite: {
    // This cast bridges a genuine dual-Vite install, not a mistake in this config.
    // Nuxt 4.4 peers on Vite 7 while vitest 3.2 bundles Vite 6, so pnpm keeps both trees and
    // @tailwindcss/vite's Plugin resolves against a different `vite` than the one typing this
    // field. The two Plugin interfaces are structurally identical apart from `hotUpdate`'s
    // `this` type, so they are interchangeable at runtime -- the build and dev server have
    // always worked; only `nuxt typecheck` failed, which is why it was never in CI.
    // Remove this cast once vitest and Nuxt agree on one major (vitest 4 peers on Vite 7).
    plugins: [tailwindcss()] as NuxtVitePlugins,
    server: {
      // Vite's dependency optimizer only discovers a lazily-loaded route's dependencies the
      // first time that route is actually visited (dynamic imports aren't part of the initial
      // crawl). On a cold `nuxt dev` process, if the FIRST visit to '/' happens via an in-app
      // client-side navigation (e.g. navigateTo('/') after login) rather than a fresh page
      // load, discovering new deps there triggers a `full-reload` HMR message that Vite's
      // client handles with a bare, path-less `location.reload()` -- if that fires before the
      // in-app navigation's own history.pushState has committed, the reload lands back on the
      // OLD url instead of the new one. Warming the home page here lets Vite crawl and
      // pre-optimize its dependencies concurrently with the rest of dev-server startup, well
      // before any real navigation reaches it.
      warmup: { clientFiles: ['./app/pages/index.vue'] },
    },
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3002/api',
      vapidPublicKey: process.env.NUXT_PUBLIC_VAPID_PUBLIC_KEY ?? '',
      // Base URL used to build absolute <loc> entries in the hand-rolled sitemap routes
      // (server/routes/sitemap*.ts) -- the sitemap protocol requires fully-qualified URLs,
      // not paths. Same env var @nuxtjs/sitemap's `site.url` used to read before this app
      // dropped that module in favor of a paginated, multi-file sitemap (see
      // server/utils/sitemap.ts).
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3003',
      // Browser crash reporting (app/plugins/sentry.client.ts). Empty = reporting is never
      // initialized at all, which is the default everywhere except a configured production
      // deploy -- see app/utils/error-reporting.ts. Being a runtimeConfig value rather than
      // a build-time `import.meta.env` read (which is what the two panels have to do) means
      // turning it on is an .env edit plus `up -d user-app`, with no image rebuild.
      sentryDsn: process.env.NUXT_PUBLIC_SENTRY_DSN ?? '',
    },
  },
  pwa: {
    strategies: 'injectManifest',
    // Nuxt 4's default `srcDir` is already `app/`, and Nuxt configures Vite's `root` to
    // that directory -- vite-plugin-pwa resolves its own `srcDir` option relative to that
    // same Vite root. Setting this to `'app'` (as a literal path segment) would therefore
    // double-resolve to `app/app/sw.ts`, which does not exist. `'.'` correctly resolves to
    // `app/sw.ts`.
    srcDir: '.',
    filename: 'sw.ts',
    registerType: 'autoUpdate',
    manifest: {
      name: 'قیچی',
      short_name: 'قیچی',
      description: 'رزرو آنلاین نوبت سالن‌های زیبایی',
      lang: 'fa',
      dir: 'rtl',
      // Brand palette, not the pre-rebrand teal these were left on: theme_color tints the
      // browser/OS chrome, background_color paints the launch splash before the app itself
      // paints -- so it must match --color-surface or the first frame flashes the wrong hue.
      theme_color: '#FFB6A3',
      background_color: '#FFF8F5',
      display: 'standalone',
      icons: [
        { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
      ],
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fa', dir: 'rtl' },
      link: [
        { rel: 'icon', type: 'image/png', href: '/favicon.png' },
        { rel: 'apple-touch-icon', href: '/pwa-192.png' },
      ],
      script: [
        {
          innerHTML: `(function(){try{var m=document.cookie.match(/(?:^|; )theme=([^;]*)/);var p=m?decodeURIComponent(m[1]):'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
        },
      ],
    },
  },
  hooks: {
    // See the sitemapSalonsHandler/sitemapPostsHandler comment above for why these are
    // pre-registered static routes rather than a file-based dynamic one.
    'nitro:config': (nitroConfig) => {
      nitroConfig.handlers ??= []
      for (let page = 1; page <= MAX_SITEMAP_PAGES; page++) {
        nitroConfig.handlers.push(
          { route: `/sitemap-salons-${page}.xml`, handler: sitemapSalonsHandler, lazy: true, middleware: false },
          { route: `/sitemap-posts-${page}.xml`, handler: sitemapPostsHandler, lazy: true, middleware: false },
        )
      }
    },
  },
})
