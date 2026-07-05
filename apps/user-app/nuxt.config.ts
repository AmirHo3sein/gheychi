import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-07-05',
  // Needed so composables like `navigateTo` still resolve the Nuxt app instance after
  // resuming from an `await` inside a nested async composable (e.g. useApi's 401 handler
  // called from auth.global.ts) -- without this, Node's default context loses track of
  // the app across the microtask boundary and throws "useNuxtApp called outside of a
  // plugin/hook/setup function".
  experimental: { asyncContext: true },
  modules: ['@pinia/nuxt', '@nuxt/test-utils/module', '@nuxt/image'],
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
    plugins: [tailwindcss()],
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3002/api',
      neshanApiKey: process.env.NUXT_PUBLIC_NESHAN_API_KEY ?? '',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fa', dir: 'rtl' },
      script: [
        {
          innerHTML: `(function(){try{var m=document.cookie.match(/(?:^|; )theme=([^;]*)/);var p=m?decodeURIComponent(m[1]):'system';var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
        },
      ],
    },
  },
})
