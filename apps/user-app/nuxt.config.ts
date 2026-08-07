import tailwindcss from '@tailwindcss/vite'

/**
 * The plugin-array type Nuxt itself expects, derived from its own config signature rather
 * than imported from 'vite' -- `vite` is not a direct dependency of this workspace, and
 * adding it would risk pinning a third copy of the very package this works around.
 */
type NuxtVitePlugins = NonNullable<NonNullable<Parameters<typeof defineNuxtConfig>[0]['vite']>['plugins']>

export default defineNuxtConfig({
  compatibilityDate: '2026-07-05',
  // Needed so composables like `navigateTo` still resolve the Nuxt app instance after
  // resuming from an `await` inside a nested async composable (e.g. useApi's 401 handler
  // called from auth.global.ts) -- without this, Node's default context loses track of
  // the app across the microtask boundary and throws "useNuxtApp called outside of a
  // plugin/hook/setup function".
  experimental: { asyncContext: true },
  modules: ['@pinia/nuxt', '@nuxt/test-utils/module', '@nuxt/image', '@vite-pwa/nuxt', '@nuxtjs/sitemap'],
  site: {
    url: process.env.NUXT_PUBLIC_SITE_URL ?? 'http://localhost:3003',
  },
  sitemap: {
    sources: ['/api/__sitemap__/urls', '/api/__sitemap__/blog'],
  },
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
})
