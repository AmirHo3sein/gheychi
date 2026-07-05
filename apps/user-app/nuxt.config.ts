import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-07-05',
  // Needed so composables like `navigateTo` still resolve the Nuxt app instance after
  // resuming from an `await` inside a nested async composable (e.g. useApi's 401 handler
  // called from auth.global.ts) -- without this, Node's default context loses track of
  // the app across the microtask boundary and throws "useNuxtApp called outside of a
  // plugin/hook/setup function".
  experimental: { asyncContext: true },
  modules: ['@pinia/nuxt', '@nuxt/test-utils/module'],
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://localhost:3002/api',
    },
  },
  app: {
    head: {
      htmlAttrs: { lang: 'fa', dir: 'rtl' },
    },
  },
})
