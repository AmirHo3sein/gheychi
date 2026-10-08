import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createWebHistory } from 'vue-router'
import App from './App.vue'
import { createAppRouter } from './router'
import { installSessionExpiryHandler } from './utils/session-expiry'
import { initErrorReporting } from './utils/error-reporting'
import './assets/css/main.css'

const app = createApp(App)
// Before any plugin or the first render, so a crash inside router/store setup is still
// caught. A no-op unless VITE_SENTRY_DSN was baked into this bundle -- see
// utils/error-reporting.ts.
initErrorReporting(app)
app.use(createPinia())
const router = createAppRouter(createWebHistory())
app.use(router)
installSessionExpiryHandler(router)
app.mount('#app')
