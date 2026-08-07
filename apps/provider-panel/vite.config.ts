import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 3004,
    // Vite's dependency optimizer only discovers a lazily-loaded route's imports the first
    // time the browser actually requests that route's chunk (every route here is
    // `component: () => import(...)`, see router/index.ts). When that first-time discovery
    // turns up a NEW dependency (e.g. leaflet/vue-multiselect, only pulled in by the
    // onboarding/settings map + category pickers), Vite has to re-bundle and sends a
    // `full-reload` HMR message mid-navigation -- which can race Vue Router's own history
    // update in AppLayout.vue's <Transition mode="out-in"> RouterView and leave the incoming
    // page un-mounted (a blank body under an already-rendered header) until a manual refresh.
    // Warming these files at server start lets the optimizer discover their dependencies
    // upfront instead of during a live navigation.
    warmup: {
      clientFiles: ['./src/pages/*.vue', './src/components/onboarding/*.vue'],
    },
  },
  optimizeDeps: {
    include: ['leaflet', 'vue-multiselect'],
  },
})
