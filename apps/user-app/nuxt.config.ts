export default defineNuxtConfig({
  compatibilityDate: '2026-07-05',
  modules: ['@pinia/nuxt', '@nuxt/test-utils/module'],
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
