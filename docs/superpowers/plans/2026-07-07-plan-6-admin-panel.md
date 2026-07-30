# Admin Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Admin Panel — a new Vue 3 + Vite SPA covering salon approvals, review moderation, categories, users/salons search+suspend, and platform_config editing — closing the biggest gap left by Provider Panel (salon approval currently requires a manual SQL update).

**Architecture:** A brand-new `apps/admin-panel` SPA, scaffolded identically to `apps/provider-panel` (same `useApi`/`useToast`/session-store/router-guard pattern, zero shared code per the isolation rule) but with a desktop-oriented sidebar nav instead of a mobile bottom nav. Built as 5 vertical slices in priority order — each slice ships its backend addition (if any) and admin frontend view together. Slice 1 also makes a small, targeted addition to `apps/provider-panel` (a Salon Settings page + resubmit-after-rejection flow), since rejecting a salon needs a recovery path on the provider side.

**Tech Stack:** Vue 3.5 + Vite, vue-router 4, Pinia, Tailwind v4 (same "Teal Trust" tokens), plain refs (no form library), Vitest + Playwright — matching `apps/provider-panel` exactly. Backend additions land in the existing `apps/api` NestJS modules (`salons`, `reviews`, `catalog`, `users`, `platform-config`), reusing the existing `AuthGuard` + `RolesGuard` + `@Roles('admin')` pattern already proven by `AdminSalonsController`/`AdminReviewsController`.

---

## Before You Start

Full design context: `docs/superpowers/specs/2026-07-07-admin-panel-design.md`. Read it if anything below is ambiguous about *why* — this plan only covers *what* and *how*.

Key facts about the existing codebase you'll rely on throughout:
- `apps/api` global prefix is `/api` (`app.setGlobalPrefix('api')`), so a controller decorated `@Controller('admin/salons')` is reachable at `/api/admin/salons`.
- Every admin controller uses `@UseGuards(AuthGuard, RolesGuard)` + `@Roles('admin')` at the class level — copy this exactly, don't invent new guard machinery.
- Migrations live in `apps/api/src/migrations/<unix-timestamp>-<kebab-name>.ts`. The most recent is `1752100000000-salon-photo-storage-key.ts`. This plan's migrations use `1752200000000`, `1752300000000`, `1752400000000` in that order (one per slice that needs one).
- e2e tests live in `apps/api/test/*.e2e-spec.ts`, using `resetDatabase()` + `createTestApp()` + `loginAs(app, phone)` from `apps/api/test/utils/`. `loginAs` always creates a plain `customer`-role user (via the real OTP flow) — there is no existing helper for an `admin`-role user, so Task 5 adds one.
- Unit tests (`.spec.ts`) are colocated next to the file they test (not a parallel `test/` tree) — this is `apps/api`'s convention, unchanged.

---

## Task 1: Admin Panel scaffold

**Files:**
- Create: `apps/admin-panel/package.json`
- Create: `apps/admin-panel/vite.config.ts`
- Create: `apps/admin-panel/vitest.config.ts`
- Create: `apps/admin-panel/tsconfig.json`
- Create: `apps/admin-panel/tsconfig.app.json`
- Create: `apps/admin-panel/tsconfig.node.json`
- Create: `apps/admin-panel/index.html`
- Create: `apps/admin-panel/src/main.ts`
- Create: `apps/admin-panel/src/App.vue`
- Create: `apps/admin-panel/src/assets/css/main.css`
- Create: `apps/admin-panel/.env.example`
- Create: `apps/admin-panel/.gitignore`
- Modify: `package.json` (root)

This mirrors `apps/provider-panel`'s scaffold exactly, with two differences: port `3005` (provider-panel already owns `3004`), and no Neshan/map dependency (Admin Panel never shows a map).

- [ ] **Step 1: Create the app directory and package.json**

```json
{
  "name": "@gheychi/admin-panel",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 3005",
    "build": "vue-tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "typecheck": "vue-tsc -b --noEmit"
  },
  "dependencies": {
    "@fontsource-variable/vazirmatn": "^5.2.8",
    "@tailwindcss/vite": "^4.3.2",
    "pinia": "^3.0.4",
    "tailwindcss": "^4.3.2",
    "vue": "^3.5.13",
    "vue-router": "^4.5.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.61.1",
    "@types/node": "^22.10.0",
    "@vitejs/plugin-vue": "^5.2.1",
    "@vue/test-utils": "^2.4.6",
    "happy-dom": "^15.11.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.2.6",
    "vue-tsc": "^3.3.6"
  }
}
```

(`pg`/`@types/pg`/`ioredis` are deliberately omitted here — those were added to `provider-panel` in Task 25 of Plan 5 for its Playwright `global-setup.ts` fixture seeding. This plan's Task 23 adds the same thing to `admin-panel` and will add those same three packages at that point, not now.)

- [ ] **Step 2: Create vite.config.ts**

```typescript
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
    port: 3005,
  },
})
```

- [ ] **Step 3: Create vitest.config.ts**

```typescript
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.spec.ts'],
  },
})
```

- [ ] **Step 4: Create the three tsconfig files**

`apps/admin-panel/tsconfig.json`:
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

`apps/admin-panel/tsconfig.app.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "preserve",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "composite": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.vue"]
}
```

`apps/admin-panel/tsconfig.node.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"],
    "composite": true,
    "noEmit": true
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 5: Create index.html**

```html
<!doctype html>
<html lang="fa" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>پنل مدیریت آرایشگاه</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 6: Create main.ts, App.vue, main.css**

`apps/admin-panel/src/main.ts`:
```typescript
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createWebHistory } from 'vue-router'
import App from './App.vue'
import { createAppRouter } from './router'
import './assets/css/main.css'

const app = createApp(App)
app.use(createPinia())
app.use(createAppRouter(createWebHistory()))
app.mount('#app')
```

`apps/admin-panel/src/App.vue` (the `ToastContainer` import will fail to resolve until Task 2 creates it — that's expected, this file isn't type-checked/built until then):
```vue
<script setup lang="ts">
import ToastContainer from '@/components/layout/ToastContainer.vue'
</script>

<template>
  <RouterView />
  <ToastContainer />
</template>
```

`apps/admin-panel/src/assets/css/main.css`:
```css
@import "tailwindcss";
@import "@fontsource-variable/vazirmatn/wght.css";

@theme static {
  --font-sans: 'Vazirmatn Variable', ui-sans-serif, system-ui, sans-serif;

  /* "Teal Trust" -- same brand tokens as provider-panel/user-app's light theme (single theme, no dark mode) */
  --color-surface: #F4FBFA;
  --color-surface-card: #FFFFFF;
  --color-text: #0B4F4A;
  --color-accent: #0EA89B;
}

html, body {
  background-color: var(--color-surface);
  color: var(--color-text);
  font-family: var(--font-sans);
}
```

- [ ] **Step 7: Create .env.example and .gitignore**

`apps/admin-panel/.env.example`:
```
VITE_API_BASE=http://localhost:3002/api
```

`apps/admin-panel/.gitignore`:
```
node_modules
dist
dist-ssr
*.local
test-results
playwright-report
tsconfig.app.tsbuildinfo
tsconfig.node.tsbuildinfo
```

- [ ] **Step 8: Add the root dev script**

Modify `package.json` (root) — add a line to `scripts` right after `dev:provider-panel`:

```json
    "dev:provider-panel": "turbo run dev --filter=@gheychi/provider-panel",
    "dev:admin-panel": "turbo run dev --filter=@gheychi/admin-panel",
```

- [ ] **Step 9: Install dependencies and verify the scaffold builds**

Run: `pnpm install`
Expected: installs cleanly, `apps/admin-panel` appears in the workspace (pnpm-workspace.yaml already globs `apps/*`, no change needed there).

Since `App.vue` references a `ToastContainer` that doesn't exist yet, typecheck will fail until Task 2 — that's fine, don't run `pnpm --filter @gheychi/admin-panel typecheck` yet.

- [ ] **Step 10: Commit**

```bash
git add apps/admin-panel package.json pnpm-lock.yaml
git commit -m "feat(admin-panel): scaffold a new Vue 3 + Vite SPA

Mirrors provider-panel's scaffold exactly (same build tooling, brand
tokens, no shared code per the cross-app isolation rule) on port 3005.
App.vue references ToastContainer.vue, added in the next task -- this
commit alone won't typecheck cleanly, which is expected."
```

---

## Task 2: useApi, useToast, ToastContainer

**Files:**
- Create: `apps/admin-panel/src/composables/useApi.ts`
- Create: `apps/admin-panel/src/composables/useApi.spec.ts`
- Create: `apps/admin-panel/src/composables/useToast.ts`
- Create: `apps/admin-panel/src/composables/useToast.spec.ts`
- Create: `apps/admin-panel/src/components/layout/ToastContainer.vue`
- Create: `apps/admin-panel/src/components/layout/ToastContainer.spec.ts`

Ported byte-for-byte from `apps/provider-panel`'s final (post-review-fix) versions — including the toast-rendering fix that plan's final review caught, so Admin Panel starts correct instead of repeating that bug.

- [ ] **Step 1: Create useToast.ts**

```typescript
// apps/admin-panel/src/composables/useToast.ts
import { ref } from 'vue'

export interface Toast {
  id: number
  message: string
}

const toasts = ref<Toast[]>([])
let counter = 0

export function useToast() {
  function push(message: string) {
    const id = counter++
    toasts.value.push({ id, message })
    setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id)
    }, 5000)
  }

  return { toasts, push }
}

// Resets the module-level singleton state back to its initial value.
// Vitest only isolates modules per test FILE, not per individual test, so a
// test file with multiple it() blocks that each assert on the toast queue
// needs an explicit reset hook to call from beforeEach -- otherwise toasts
// pushed by an earlier test leak into a later one. Mirrors resetSalon() in
// provider-panel's useSalon.ts.
export function resetToast(): void {
  toasts.value = []
}
```

- [ ] **Step 2: Create useToast.spec.ts**

```typescript
// apps/admin-panel/src/composables/useToast.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetToast, useToast } from './useToast'

describe('useToast', () => {
  beforeEach(() => {
    resetToast()
    vi.useFakeTimers()
  })

  it('pushes a message onto the shared queue', () => {
    const { toasts, push } = useToast()
    push('چیزی اشتباه پیش رفت')
    expect(toasts.value).toHaveLength(1)
    expect(toasts.value[0]!.message).toBe('چیزی اشتباه پیش رفت')
  })

  it('auto-dismisses a toast after 5 seconds', () => {
    const { toasts, push } = useToast()
    push('پیام موقت')
    expect(toasts.value).toHaveLength(1)
    vi.advanceTimersByTime(5000)
    expect(toasts.value).toHaveLength(0)
    vi.useRealTimers()
  })
})
```

- [ ] **Step 3: Run it to see it pass (nothing to fail against yet -- this file has no prior implementation gap, so write+verify together)**

Run: `pnpm --filter @gheychi/admin-panel test -- --run useToast`
Expected: 2 passed

- [ ] **Step 4: Create useApi.ts**

```typescript
// apps/admin-panel/src/composables/useApi.ts
import { useToast } from './useToast'

export interface ApiError {
  status: number
  message: string
}

export interface ApiResult<T> {
  data: T | null
  error: ApiError | null
}

interface ApiFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  silent?: boolean
  /** Set to false to suppress the automatic redirect-to-/login on a 401 (defaults to true). */
  redirectOn401?: boolean
}

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://localhost:3002/api'

export function useApi() {
  async function apiFetch<T>(path: string, options: ApiFetchOptions = {}): Promise<ApiResult<T>> {
    const isFormData = options.body instanceof FormData

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: options.method ?? 'GET',
        credentials: 'include',
        headers: isFormData ? undefined : { 'Content-Type': 'application/json' },
        body:
          options.body === undefined
            ? undefined
            : isFormData
              ? (options.body as FormData)
              : JSON.stringify(options.body),
      })

      if (!res.ok) {
        let message = 'Something went wrong'
        try {
          message = (await res.json())?.message ?? message
        } catch {
          // response body wasn't JSON -- keep the default message
        }
        const apiError: ApiError = { status: res.status, message }

        if (apiError.status === 401) {
          if (options.redirectOn401 !== false) window.location.href = '/login'
          return { data: null, error: apiError }
        }

        if (!options.silent) useToast().push(message)
        return { data: null, error: apiError }
      }

      const data = res.status === 204 ? null : ((await res.json()) as T)
      return { data, error: null }
    } catch {
      const apiError: ApiError = { status: 0, message: 'Network error' }
      if (!options.silent) useToast().push(apiError.message)
      return { data: null, error: apiError }
    }
  }

  return { apiFetch }
}
```

- [ ] **Step 5: Create useApi.spec.ts**

```typescript
// apps/admin-panel/src/composables/useApi.spec.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetToast, useToast } from './useToast'
import { useApi } from './useApi'

describe('useApi', () => {
  const originalFetch = global.fetch
  const originalLocation = window.location

  beforeEach(() => {
    resetToast()
    global.fetch = vi.fn()
    // @ts-expect-error -- deleting to allow reassignment below
    delete window.location
    window.location = { ...originalLocation, href: '' } as Location
  })

  afterEach(() => {
    global.fetch = originalFetch
    window.location = originalLocation
  })

  it('returns parsed JSON data on a 200 response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    const { apiFetch } = useApi()
    const { data, error } = await apiFetch<{ ok: boolean }>('/ping')
    expect(data).toEqual({ ok: true })
    expect(error).toBeNull()
  })

  it('returns null data with no body on a 204 response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 204 }))
    const { apiFetch } = useApi()
    const { data, error } = await apiFetch('/ping')
    expect(data).toBeNull()
    expect(error).toBeNull()
  })

  it('pushes a toast and returns an ApiError on a non-401 failure by default', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ message: 'bad request' }), { status: 400 }),
    )
    const { apiFetch } = useApi()
    const { data, error } = await apiFetch('/ping')
    expect(data).toBeNull()
    expect(error).toEqual({ status: 400, message: 'bad request' })
    expect(useToast().toasts.value).toHaveLength(1)
  })

  it('suppresses the toast when silent is true', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 500 }))
    const { apiFetch } = useApi()
    await apiFetch('/ping', { silent: true })
    expect(useToast().toasts.value).toHaveLength(0)
  })

  it('redirects to /login on a 401 by default', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 401 }))
    const { apiFetch } = useApi()
    await apiFetch('/ping')
    expect(window.location.href).toBe('/login')
  })

  it('does not redirect on a 401 when redirectOn401 is false', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 401 }))
    const { apiFetch } = useApi()
    await apiFetch('/ping', { redirectOn401: false })
    expect(window.location.href).toBe('')
  })

  it('returns a network ApiError when fetch itself throws', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('boom'))
    const { apiFetch } = useApi()
    const { data, error } = await apiFetch('/ping')
    expect(data).toBeNull()
    expect(error).toEqual({ status: 0, message: 'Network error' })
  })
})
```

- [ ] **Step 6: Run it**

Run: `pnpm --filter @gheychi/admin-panel test -- --run useApi`
Expected: 7 passed

- [ ] **Step 7: Create ToastContainer.vue**

```vue
<!-- apps/admin-panel/src/components/layout/ToastContainer.vue -->
<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { toasts } = useToast()
</script>

<template>
  <div class="fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      data-testid="toast"
      class="w-full max-w-sm rounded-lg bg-(--color-text) px-4 py-3 text-sm text-white shadow-lg"
    >
      {{ toast.message }}
    </div>
  </div>
</template>
```

- [ ] **Step 8: Create ToastContainer.spec.ts**

```typescript
// apps/admin-panel/src/components/layout/ToastContainer.spec.ts
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetToast, useToast } from '@/composables/useToast'
import ToastContainer from './ToastContainer.vue'

describe('ToastContainer', () => {
  beforeEach(() => {
    resetToast()
  })

  it('renders a pushed toast message', async () => {
    const { push } = useToast()
    const wrapper = mount(ToastContainer)
    push('چیزی اشتباه پیش رفت')
    await wrapper.vm.$nextTick()
    expect(wrapper.text()).toContain('چیزی اشتباه پیش رفت')
  })

  it('renders multiple concurrent toasts', async () => {
    const { push } = useToast()
    const wrapper = mount(ToastContainer)
    push('پیام اول')
    push('پیام دوم')
    await wrapper.vm.$nextTick()
    expect(wrapper.findAll('[data-testid="toast"]')).toHaveLength(2)
  })
})
```

- [ ] **Step 9: Run the full suite and typecheck**

Run: `pnpm --filter @gheychi/admin-panel test -- --run`
Expected: 3 files, 11 tests passed

Run: `pnpm --filter @gheychi/admin-panel typecheck`
Expected: no errors (App.vue's `ToastContainer` import now resolves)

- [ ] **Step 10: Commit**

```bash
git add apps/admin-panel/src/composables apps/admin-panel/src/components
git commit -m "feat(admin-panel): add useApi/useToast composables and ToastContainer

Ported from provider-panel's final versions, including the toast-rendering
fix that plan's final review caught (ToastContainer mounted from the
start here, not bolted on after the fact)."
```

---

## Task 3: Session store, LoginView, router skeleton

**Files:**
- Create: `apps/admin-panel/src/stores/session.ts`
- Create: `apps/admin-panel/src/pages/LoginView.vue`
- Create: `apps/admin-panel/src/pages/LoginView.spec.ts`
- Create: `apps/admin-panel/src/router/index.ts`
- Create: `apps/admin-panel/src/router/index.spec.ts`

Same phone+OTP login flow as Provider Panel, and the same session-check + redirect-to-login router guard shape — but with one difference: after login, the guard also checks `session.user.role === 'admin'` and redirects a non-admin to a dedicated "access denied" state (there's no salon/onboarding gating here, since Admin Panel has no concept of "my salon"). `AppLayout`/sidebar nav come in Task 4; for now, authenticated non-login routes render directly (this task establishes login + guard only, matching how Provider Panel's Task 11 built its guard before Task 17 added `AppLayout` on top).

- [ ] **Step 1: Create the session store**

```typescript
// apps/admin-panel/src/stores/session.ts
import { defineStore } from 'pinia'

export interface SessionUser {
  id: string
  phone: string
  name: string | null
  gender: 'female' | 'male' | null
  role: 'customer' | 'provider' | 'admin'
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    user: null as SessionUser | null,
    checked: false, // becomes true once we've asked the API at least once this session
  }),
  getters: {
    isLoggedIn: (state) => !!state.user,
    isAdmin: (state) => state.user?.role === 'admin',
  },
  actions: {
    setUser(user: SessionUser | null) {
      this.user = user
      this.checked = true
    },
  },
})
```

- [ ] **Step 2: Write the failing test for LoginView**

```typescript
// apps/admin-panel/src/pages/LoginView.spec.ts
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import LoginView from './LoginView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('LoginView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
  })

  async function mountWithRouter() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/login', component: LoginView },
        { path: '/', component: { template: '<div />' } },
      ],
    })
    router.push('/login')
    await router.isReady()
    return mount(LoginView, { global: { plugins: [router] } })
  }

  it('requests an OTP for the entered phone number', async () => {
    fetchMock.mockResolvedValueOnce({ data: { ok: true }, error: null })
    const wrapper = await mountWithRouter()

    await wrapper.get('[data-testid="phone-input"]').setValue('09120000900')
    await wrapper.get('[data-testid="phone-form"]').find('button').trigger('click')
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/auth/request-otp', {
      method: 'POST',
      body: { phone: '09120000900' },
      silent: true,
    })
    expect(wrapper.find('[data-testid="code-input"]').exists()).toBe(true)
  })

  it('shows an inline error and does not advance when the OTP request fails', async () => {
    fetchMock.mockResolvedValueOnce({ data: null, error: { status: 429, message: 'too many requests' } })
    const wrapper = await mountWithRouter()

    await wrapper.get('[data-testid="phone-input"]').setValue('09120000900')
    await wrapper.get('[data-testid="phone-form"]').find('button').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="code-input"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('too many requests')
  })

  it('verifies the code and navigates to / on success', async () => {
    fetchMock
      .mockResolvedValueOnce({ data: { ok: true }, error: null })
      .mockResolvedValueOnce({
        data: { user: { id: 'u1', phone: '09120000900', name: null, gender: null, role: 'admin' }, isNewUser: false },
        error: null,
      })
    const wrapper = await mountWithRouter()

    await wrapper.get('[data-testid="phone-input"]').setValue('09120000900')
    await wrapper.get('[data-testid="phone-form"]').find('button').trigger('click')
    await wrapper.vm.$nextTick()

    await wrapper.get('[data-testid="code-input"]').setValue('123456')
    await wrapper.get('[data-testid="code-form"]').find('button').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(fetchMock).toHaveBeenCalledWith('/auth/verify-otp', {
      method: 'POST',
      body: { phone: '09120000900', code: '123456' },
      silent: true,
    })
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @gheychi/admin-panel test -- --run LoginView`
Expected: FAIL with "Cannot find module './LoginView.vue'" (or similar — the component doesn't exist yet)

- [ ] **Step 4: Create LoginView.vue**

```vue
<!-- apps/admin-panel/src/pages/LoginView.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useApi } from '@/composables/useApi'
import { useSessionStore } from '@/stores/session'

const { apiFetch } = useApi()
const session = useSessionStore()
const router = useRouter()

const phone = ref('')
const code = ref('')
const step = ref<'phone' | 'code'>('phone')
const errorMessage = ref('')

async function requestOtp() {
  errorMessage.value = ''
  const { error } = await apiFetch('/auth/request-otp', {
    method: 'POST',
    body: { phone: phone.value },
    silent: true,
  })
  if (error) {
    errorMessage.value = error.message
    return
  }
  step.value = 'code'
}

async function verifyOtp() {
  errorMessage.value = ''
  const { data, error } = await apiFetch<{
    user: { id: string; phone: string; name: string | null; gender: 'female' | 'male' | null; role: 'customer' | 'provider' | 'admin' }
  }>('/auth/verify-otp', {
    method: 'POST',
    body: { phone: phone.value, code: code.value },
    silent: true,
  })
  if (error || !data) {
    errorMessage.value = error?.message ?? 'کد وارد شده نامعتبر است'
    return
  }
  session.setUser(data.user)
  await router.push('/')
}
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-4 p-6">
    <h1 class="text-xl font-bold">ورود مدیر</h1>

    <form v-if="step === 'phone'" data-testid="phone-form" class="space-y-3" @submit.prevent="requestOtp">
      <input
        v-model="phone"
        data-testid="phone-input"
        type="tel"
        placeholder="شماره موبایل"
        class="w-full rounded-lg border p-3"
      />
      <button type="submit" class="w-full rounded-lg bg-(--color-accent) p-3 text-white">ارسال کد</button>
    </form>

    <form v-else data-testid="code-form" class="space-y-3" @submit.prevent="verifyOtp">
      <input
        v-model="code"
        data-testid="code-input"
        type="text"
        placeholder="کد تایید"
        class="w-full rounded-lg border p-3"
      />
      <button type="submit" class="w-full rounded-lg bg-(--color-accent) p-3 text-white">تایید</button>
    </form>

    <p v-if="errorMessage" class="text-sm text-red-600">{{ errorMessage }}</p>
  </div>
</template>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @gheychi/admin-panel test -- --run LoginView`
Expected: PASS (3 tests)

- [ ] **Step 6: Write the failing test for the router guard**

```typescript
// apps/admin-panel/src/router/index.spec.ts
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import { createAppRouter } from './index'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('admin-panel router guard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
  })

  it('redirects an unauthenticated visitor to /login', async () => {
    fetchMock.mockResolvedValue({ data: null, error: { status: 401, message: 'unauthorized' } })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('redirects a non-admin user to /forbidden', async () => {
    fetchMock.mockResolvedValue({
      data: { id: 'u1', phone: '0912', name: null, gender: null, role: 'customer' },
      error: null,
    })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('forbidden')
  })

  it('lets an admin user through to the dashboard', async () => {
    fetchMock.mockResolvedValue({
      data: { id: 'u1', phone: '0912', name: null, gender: null, role: 'admin' },
      error: null,
    })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('does not treat a transient network error as a confirmed logout', async () => {
    const session = useSessionStore()
    session.setUser({ id: 'u1', phone: '0912', name: null, gender: null, role: 'admin' })
    session.checked = false // force the guard to re-check despite already having a user
    fetchMock.mockResolvedValue({ data: null, error: { status: 0, message: 'Network error' } })

    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })
})
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @gheychi/admin-panel test -- --run router`
Expected: FAIL with "Cannot find module './index'" (router doesn't exist yet)

- [ ] **Step 8: Create the router**

```typescript
// apps/admin-panel/src/router/index.ts
import { createRouter, type RouterHistory, type Router } from 'vue-router'
import type { SessionUser } from '@/stores/session'
import { useSessionStore } from '@/stores/session'
import { useApi } from '@/composables/useApi'

const routes = [
  { path: '/login', name: 'login', component: () => import('@/pages/LoginView.vue'), meta: { public: true } },
  { path: '/forbidden', name: 'forbidden', component: () => import('@/pages/ForbiddenView.vue') },
  { path: '/', name: 'dashboard', component: () => import('@/pages/DashboardView.vue') },
]

export function createAppRouter(history: RouterHistory): Router {
  const router = createRouter({ history, routes })

  router.beforeEach(async (to) => {
    const session = useSessionStore()

    if (!session.checked) {
      const { apiFetch } = useApi()
      const { data, error } = await apiFetch<SessionUser>('/auth/me', { silent: true, redirectOn401: false })
      // A network/5xx error isn't the same as a confirmed 401 -- don't mark session.checked
      // in that case, so the next navigation retries instead of permanently treating a
      // transient blip as "confirmed logged out." Mirrors provider-panel's router guard.
      if (!error || error.status === 401) {
        session.setUser(data)
      }
    }

    if (to.meta.public) {
      return session.isLoggedIn ? { name: 'dashboard' } : true
    }

    if (!session.isLoggedIn) {
      return { name: 'login' }
    }

    if (!session.isAdmin) {
      return to.name === 'forbidden' ? true : { name: 'forbidden' }
    }

    if (to.name === 'forbidden') {
      return { name: 'dashboard' }
    }

    return true
  })

  return router
}
```

- [ ] **Step 9: Create a placeholder ForbiddenView and DashboardView so the router resolves**

```vue
<!-- apps/admin-panel/src/pages/ForbiddenView.vue -->
<script setup lang="ts"></script>

<template>
  <div class="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
    <h1 class="text-xl font-bold">دسترسی غیرمجاز</h1>
    <p class="text-sm">این بخش فقط برای مدیران سیستم قابل دسترسی است.</p>
  </div>
</template>
```

```vue
<!-- apps/admin-panel/src/pages/DashboardView.vue -->
<script setup lang="ts"></script>

<template>
  <div class="p-4">
    <h1 class="text-lg font-bold">داشبورد مدیریت</h1>
  </div>
</template>
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm --filter @gheychi/admin-panel test -- --run`
Expected: 5 files, 18 tests passed

Run: `pnpm --filter @gheychi/admin-panel typecheck`
Expected: no errors

- [ ] **Step 11: Commit**

```bash
git add apps/admin-panel/src
git commit -m "feat(admin-panel): add session store, login, and role-gated router guard

Same phone+OTP flow and transient-vs-confirmed-error distinction as
provider-panel's router guard, but gates on role === 'admin' instead of
salon-approval status (there's no 'my salon' concept in this app)."
```

---

## Task 4: AppLayout with a sidebar nav

**Files:**
- Create: `apps/admin-panel/src/components/layout/SidebarNav.vue`
- Create: `apps/admin-panel/src/components/layout/AppLayout.vue`
- Modify: `apps/admin-panel/src/router/index.ts`

Nests the dashboard (and every route added by later tasks) under `AppLayout`, matching Provider Panel's `path: '/'` parent-route pattern — but with a sidebar instead of a bottom tab bar, since this is a desktop-oriented back-office tool, not a mobile one (per the design doc). The sidebar links to all 5 slices now, even though only Dashboard exists yet — later tasks' pages will resolve those links as they're built, matching how Provider Panel's Task 17 built the full bottom nav before every tab's view existed.

- [ ] **Step 1: Create SidebarNav.vue**

```vue
<!-- apps/admin-panel/src/components/layout/SidebarNav.vue -->
<script setup lang="ts">
const LINKS = [
  { to: '/', label: 'داشبورد' },
  { to: '/salons', label: 'آرایشگاه‌ها' },
  { to: '/reviews', label: 'نظرات' },
  { to: '/categories', label: 'دسته‌بندی‌ها' },
  { to: '/users', label: 'کاربران' },
  { to: '/config', label: 'تنظیمات' },
]
</script>

<template>
  <nav class="flex h-screen w-56 shrink-0 flex-col gap-1 border-l bg-(--color-surface-card) p-4">
    <RouterLink
      v-for="link in LINKS"
      :key="link.to"
      :to="link.to"
      class="rounded-lg px-3 py-2 text-sm"
      active-class="bg-(--color-accent) font-bold text-white"
    >
      {{ link.label }}
    </RouterLink>
  </nav>
</template>
```

- [ ] **Step 2: Create AppLayout.vue**

```vue
<!-- apps/admin-panel/src/components/layout/AppLayout.vue -->
<script setup lang="ts"></script>

<template>
  <div class="flex">
    <SidebarNav />
    <main class="flex-1"><RouterView /></main>
  </div>
</template>

<script lang="ts">
import SidebarNav from './SidebarNav.vue'
export default { components: { SidebarNav } }
</script>
```

- [ ] **Step 3: Nest the dashboard route under AppLayout**

Modify `apps/admin-panel/src/router/index.ts` — replace the flat `dashboard` route entry with a nested structure:

```typescript
import { createRouter, type RouterHistory, type Router } from 'vue-router'
import type { SessionUser } from '@/stores/session'
import { useSessionStore } from '@/stores/session'
import { useApi } from '@/composables/useApi'
import AppLayout from '@/components/layout/AppLayout.vue'

const routes = [
  { path: '/login', name: 'login', component: () => import('@/pages/LoginView.vue'), meta: { public: true } },
  { path: '/forbidden', name: 'forbidden', component: () => import('@/pages/ForbiddenView.vue') },
  {
    path: '/',
    component: AppLayout,
    children: [{ path: '', name: 'dashboard', component: () => import('@/pages/DashboardView.vue') }],
  },
]

export function createAppRouter(history: RouterHistory): Router {
  const router = createRouter({ history, routes })

  router.beforeEach(async (to) => {
    const session = useSessionStore()

    if (!session.checked) {
      const { apiFetch } = useApi()
      const { data, error } = await apiFetch<SessionUser>('/auth/me', { silent: true, redirectOn401: false })
      if (!error || error.status === 401) {
        session.setUser(data)
      }
    }

    if (to.meta.public) {
      return session.isLoggedIn ? { name: 'dashboard' } : true
    }

    if (!session.isLoggedIn) {
      return { name: 'login' }
    }

    if (!session.isAdmin) {
      return to.name === 'forbidden' ? true : { name: 'forbidden' }
    }

    if (to.name === 'forbidden') {
      return { name: 'dashboard' }
    }

    return true
  })

  return router
}
```

(Only the `routes` array and the new `AppLayout` import changed — the guard logic itself is untouched, so `router/index.spec.ts` from Task 3 keeps passing unmodified.)

- [ ] **Step 4: Run the full suite and typecheck**

Run: `pnpm --filter @gheychi/admin-panel test -- --run`
Expected: 5 files, 18 tests passed (unchanged from Task 3 — this task added no new test file, since `SidebarNav`/`AppLayout` are pure layout with no logic to unit test, matching Provider Panel's `BottomNav`/`AppLayout` precedent)

Run: `pnpm --filter @gheychi/admin-panel typecheck`
Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/admin-panel/src/components/layout apps/admin-panel/src/router
git commit -m "feat(admin-panel): add AppLayout with a sidebar nav

Sidebar (not a bottom tab bar) since this is a desktop-oriented
back-office tool per the design doc, unlike provider-panel's mobile-first
bottom nav. Links to all 5 slices now; only Dashboard resolves today,
later tasks fill in the rest."
```

---

## Task 5: Backend -- salon 'rejected' status, rejection_reason column, and an admin-role test helper

**Files:**
- Create: `apps/api/src/migrations/1752200000000-salon-rejection-reason.ts`
- Modify: `apps/api/src/salons/salon.entity.ts`
- Modify: `apps/api/test/utils/auth-helper.ts`

Slice 1 (salon approvals) starts here. This task only adds the schema/entity groundwork and a shared test helper — no new endpoints yet (that's Task 6-7).

- [ ] **Step 1: Write the migration**

```typescript
// apps/api/src/migrations/1752200000000-salon-rejection-reason.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class SalonRejectionReason1752200000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE salons ADD COLUMN rejection_reason text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE salons DROP COLUMN rejection_reason`);
  }
}
```

(No CHECK constraint needs updating for the `'rejected'` status value — `salons.status` is a plain `varchar` column with no DB-level enum/check, same as every other status column in this schema. Only the TypeScript-side type needs to grow.)

- [ ] **Step 2: Update the Salon entity**

Modify `apps/api/src/salons/salon.entity.ts` — change the `SalonStatus` type and add the new column:

```typescript
export type SalonStatus = 'pending' | 'approved' | 'rejected' | 'suspended';
```

Add this column after `status` (line 32 in the current file):

```typescript
  @Column({ name: 'rejection_reason', type: 'text', nullable: true })
  rejectionReason: string | null;
```

- [ ] **Step 3: Run the migration against the dev database and verify**

Run: `pnpm --filter @gheychi/api migration:run`
Expected: `SalonRejectionReason1752200000000 has been executed successfully.`

- [ ] **Step 4: Add the admin-role test helper**

Modify `apps/api/test/utils/auth-helper.ts` — add a new export alongside the existing `loginAs`:

```typescript
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import Redis from 'ioredis';
import request from 'supertest';
import { Repository } from 'typeorm';
import { REDIS } from '../../src/redis/redis.module';
import { User } from '../../src/users/user.entity';

/** Full OTP login; returns the session cookie string for use with .set('Cookie', ...) */
export async function loginAs(app: INestApplication, phone: string): Promise<string> {
  const redis = app.get<Redis>(REDIS);
  await redis.del(`otp:rl:${phone}`);
  await request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone }).expect(201);
  const code = await redis.get(`otp:${phone}`);
  const res = await request(app.getHttpServer())
    .post('/api/auth/verify-otp')
    .send({ phone, code })
    .expect(201);
  return res.get('Set-Cookie')!.find((c: string) => c.startsWith('session='))!;
}

/**
 * Logs in as `phone` (creating the user via the real OTP flow, same as loginAs), then
 * promotes that user directly to role='admin' via the repository. There's no self-service
 * admin signup in this codebase (by design -- the first admin is always a manual DB step,
 * same as this whole plan's premise for salon approval before Slice 1 existed), so tests
 * that need an admin session go through this instead of a real endpoint.
 */
export async function loginAsAdmin(app: INestApplication, phone: string): Promise<string> {
  const cookie = await loginAs(app, phone);
  const users = app.get<Repository<User>>(getRepositoryToken(User));
  await users.update({ phone }, { role: 'admin' });
  return cookie;
}
```

- [ ] **Step 5: Run the existing e2e suite to confirm nothing broke**

Run: `pnpm --filter @gheychi/api test:e2e`
Expected: all existing suites still pass (this task added no new spec file yet, `loginAsAdmin` is unused until Task 7)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/migrations/1752200000000-salon-rejection-reason.ts apps/api/src/salons/salon.entity.ts apps/api/test/utils/auth-helper.ts
git commit -m "feat(api): add salon 'rejected' status, rejection_reason column, admin test helper

Groundwork for the admin salon-approval endpoints in the next two tasks.
loginAsAdmin() promotes a real OTP-created user to role='admin' directly
via the repository, since there's no self-service admin signup by design."
```

---

## Task 6: Backend -- filterable admin salon list

**Files:**
- Modify: `apps/api/src/salons/admin-salons.controller.ts`
- Create: `apps/api/src/salons/dto/admin-salon-query.dto.ts`
- Create: `apps/api/test/admin-salons-list.e2e-spec.ts`

Generalizes `AdminSalonsController.list()` from hardcoded `status: 'approved'` to accept `status`/`city`/`name`/`genderTarget` filters, defaulting to `status=pending` when no status filter is given (so the queue view Task 10 builds shows the actionable list by default). This same endpoint serves Slice 4 (Task 20)'s broader salon search later — no changes needed there.

- [ ] **Step 1: Write the failing e2e test**

```typescript
// apps/api/test/admin-salons-list.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin salon list filters (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122230001');

    const ownerCookie = await loginAs(app, '09122230002');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Pending Salon Tehran',
      genderTarget: 'women',
      address: 'Somewhere St, No. 5',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });

    const owner2Cookie = await loginAs(app, '09122230003');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', owner2Cookie).send({
      name: 'Pending Salon Shiraz',
      genderTarget: 'men',
      address: 'Somewhere St, No. 6',
      city: 'Shiraz',
      lat: 29.6,
      lng: 52.5,
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('defaults to status=pending when no filter is given', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((s: { status: string }) => s.status === 'pending')).toBe(true);
  });

  it('filters by city', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?city=Shiraz')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Pending Salon Shiraz');
  });

  it('filters by genderTarget', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?genderTarget=men')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Pending Salon Shiraz');
  });

  it('filters by name (partial, case-insensitive)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?name=tehran')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Pending Salon Tehran');
  });

  it('an explicit status=approved filter overrides the pending default', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?status=approved')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(0);
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122230004');
    await request(app.getHttpServer())
      .get('/api/admin/salons')
      .set('Cookie', customerCookie)
      .expect(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-salons-list`
Expected: FAIL (the `city`/`genderTarget`/`name` filters aren't implemented, `list()` still hardcodes `approved`)

- [ ] **Step 3: Create the query DTO**

```typescript
// apps/api/src/salons/dto/admin-salon-query.dto.ts
import { IsIn, IsOptional, IsString } from 'class-validator';
import { SalonStatus } from '../salon.entity';

export class AdminSalonQueryDto {
  @IsOptional()
  @IsIn(['pending', 'approved', 'rejected', 'suspended'])
  status?: SalonStatus;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['women', 'men'])
  genderTarget?: 'women' | 'men';
}
```

- [ ] **Step 4: Update AdminSalonsController.list()**

Modify `apps/api/src/salons/admin-salons.controller.ts`:

```typescript
import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminSalonQueryDto } from './dto/admin-salon-query.dto';
import { SetFeaturedDto } from './dto/admin-salon.dto';
import { Salon } from './salon.entity';

@Controller('admin/salons')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminSalonsController {
  constructor(@InjectRepository(Salon) private readonly salons: Repository<Salon>) {}

  @Get()
  list(@Query() query: AdminSalonQueryDto) {
    const qb = this.salons
      .createQueryBuilder('salon')
      .select(['salon.id', 'salon.name', 'salon.city', 'salon.status', 'salon.genderTarget', 'salon.isFeatured', 'salon.featuredUntil', 'salon.createdAt'])
      .where('salon.status = :status', { status: query.status ?? 'pending' })
      .orderBy('salon.name', 'ASC');

    if (query.city) qb.andWhere('salon.city ILIKE :city', { city: `%${query.city}%` });
    if (query.name) qb.andWhere('salon.name ILIKE :name', { name: `%${query.name}%` });
    if (query.genderTarget) qb.andWhere('salon.genderTarget = :genderTarget', { genderTarget: query.genderTarget });

    return qb.getMany();
  }

  @Patch(':id/featured')
  async setFeatured(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetFeaturedDto) {
    const result = await this.salons.update(
      { id },
      { isFeatured: dto.isFeatured, featuredUntil: dto.featuredUntil ? new Date(dto.featuredUntil) : null },
    );
    if (!result.affected) throw new NotFoundException();
    return this.salons.findOneBy({ id });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-salons-list`
Expected: PASS (6 tests)

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

Run: `pnpm --filter @gheychi/api test:e2e`
Expected: all suites pass, including the pre-existing `admin-salons` featured-toggle coverage (unaffected — `setFeatured` wasn't touched)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/salons/admin-salons.controller.ts apps/api/src/salons/dto/admin-salon-query.dto.ts apps/api/test/admin-salons-list.e2e-spec.ts
git commit -m "feat(api): filterable admin salon list, defaulting to pending

Generalizes AdminSalonsController.list() from a hardcoded status=approved
to status/city/name/genderTarget query filters, defaulting to pending so
the approval queue view shows the actionable list without an explicit
filter. This same endpoint will serve the broader salon search in Slice 4."
```

---

## Task 7: Backend -- PATCH /admin/salons/:id/status (approve/reject/suspend)

**Files:**
- Modify: `apps/api/src/salons/admin-salons.controller.ts`
- Create: `apps/api/src/salons/dto/admin-salon-status.dto.ts`
- Create: `apps/api/test/admin-salon-status.e2e-spec.ts`

The single endpoint covering approve (`pending`→`approved`), reject (`pending`→`rejected`, reason required), and suspend (`approved`→`suspended`, reason required). Reason is validated server-side too, not just client-side (per the design doc's "reason required" rule) — a required-when-conditionally rule, enforced via a custom validator rather than trusting the frontend alone.

- [ ] **Step 1: Write the failing e2e test**

```typescript
// apps/api/test/admin-salon-status.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin salon status transitions (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122240001');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const ownerPhone = `0912224${Math.floor(1000 + Math.random() * 8999)}`;
    const ownerCookie = await loginAs(app, ownerPhone);
    const createRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: `Status Test Salon ${ownerPhone}`,
      genderTarget: 'women',
      address: 'Somewhere St, No. 7',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
    salonId = createRes.body.id;
  });

  it('approves a pending salon with no reason required', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);
    expect(res.body.status).toBe('approved');
    expect(res.body.rejectionReason).toBeNull();
  });

  it('rejects a pending salon and stores the reason', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'rejected', reason: 'آدرس نامعتبر است' })
      .expect(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body.rejectionReason).toBe('آدرس نامعتبر است');
  });

  it('400s a reject with no reason', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'rejected' })
      .expect(400);
  });

  it('suspends an already-approved salon and stores the reason', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'suspended', reason: 'شکایت مشتری' })
      .expect(200);
    expect(res.body.status).toBe('suspended');
    expect(res.body.rejectionReason).toBe('شکایت مشتری');
  });

  it('400s a suspend with no reason', async () => {
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'suspended' })
      .expect(400);
  });

  it('404s an unknown salon id', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/salons/00000000-0000-0000-0000-000000000000/status')
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(404);
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122240099');
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', customerCookie)
      .send({ status: 'approved' })
      .expect(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-salon-status`
Expected: FAIL with 404 (route doesn't exist yet)

- [ ] **Step 3: Create the status DTO with a conditional-reason validator**

```typescript
// apps/api/src/salons/dto/admin-salon-status.dto.ts
import { registerDecorator, ValidationOptions, ValidationArguments } from 'class-validator';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

function RequiredWhenRejectingOrSuspending(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'requiredWhenRejectingOrSuspending',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const status = (args.object as AdminSalonStatusDto).status;
          if (status !== 'rejected' && status !== 'suspended') return true;
          return typeof value === 'string' && value.trim().length > 0;
        },
        defaultMessage() {
          return 'reason is required when rejecting or suspending a salon';
        },
      },
    });
  };
}

export class AdminSalonStatusDto {
  @IsIn(['approved', 'rejected', 'suspended'])
  status: 'approved' | 'rejected' | 'suspended';

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  @RequiredWhenRejectingOrSuspending()
  reason?: string;
}
```

- [ ] **Step 4: Add the status endpoint**

Modify `apps/api/src/salons/admin-salons.controller.ts` — add the import and a new method:

```typescript
import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminSalonQueryDto } from './dto/admin-salon-query.dto';
import { AdminSalonStatusDto } from './dto/admin-salon-status.dto';
import { SetFeaturedDto } from './dto/admin-salon.dto';
import { Salon } from './salon.entity';

@Controller('admin/salons')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminSalonsController {
  constructor(@InjectRepository(Salon) private readonly salons: Repository<Salon>) {}

  @Get()
  list(@Query() query: AdminSalonQueryDto) {
    const qb = this.salons
      .createQueryBuilder('salon')
      .select(['salon.id', 'salon.name', 'salon.city', 'salon.status', 'salon.genderTarget', 'salon.isFeatured', 'salon.featuredUntil', 'salon.createdAt'])
      .where('salon.status = :status', { status: query.status ?? 'pending' })
      .orderBy('salon.name', 'ASC');

    if (query.city) qb.andWhere('salon.city ILIKE :city', { city: `%${query.city}%` });
    if (query.name) qb.andWhere('salon.name ILIKE :name', { name: `%${query.name}%` });
    if (query.genderTarget) qb.andWhere('salon.genderTarget = :genderTarget', { genderTarget: query.genderTarget });

    return qb.getMany();
  }

  @Patch(':id/status')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminSalonStatusDto) {
    const result = await this.salons.update(
      { id },
      { status: dto.status, rejectionReason: dto.status === 'approved' ? null : (dto.reason ?? null) },
    );
    if (!result.affected) throw new NotFoundException();
    return this.salons.findOneBy({ id });
  }

  @Patch(':id/featured')
  async setFeatured(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetFeaturedDto) {
    const result = await this.salons.update(
      { id },
      { isFeatured: dto.isFeatured, featuredUntil: dto.featuredUntil ? new Date(dto.featuredUntil) : null },
    );
    if (!result.affected) throw new NotFoundException();
    return this.salons.findOneBy({ id });
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-salon-status`
Expected: PASS (7 tests)

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

Run: `pnpm --filter @gheychi/api test:e2e`
Expected: all suites pass

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/salons/admin-salons.controller.ts apps/api/src/salons/dto/admin-salon-status.dto.ts apps/api/test/admin-salon-status.e2e-spec.ts
git commit -m "feat(api): PATCH /admin/salons/:id/status -- approve/reject/suspend

One endpoint for all three transitions. reason is validated server-side
as required specifically for reject/suspend (not just enforced by the
frontend), via a custom class-validator that reads the sibling status
field. Approving clears any prior rejectionReason."
```

---

## Task 8: Backend -- Provider Panel resubmit endpoint

**Files:**
- Modify: `apps/api/src/salons/salons.controller.ts`
- Modify: `apps/api/src/salons/salons.service.ts`
- Modify: `apps/api/src/salons/salons.service.spec.ts` (create if it doesn't exist yet)
- Create: `apps/api/test/salon-resubmit.e2e-spec.ts`

`POST /salons/mine/resubmit` flips a caller's own salon from `rejected` back to `pending`, so the flow closes: admin rejects with a reason → provider edits via the new Salon Settings page (Task 11) → provider resubmits → salon reappears in the admin queue (Task 6's default `status=pending` filter already covers this, no admin-side change needed).

- [ ] **Step 1: Write the failing e2e test**

```typescript
// apps/api/test/salon-resubmit.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Salon resubmit after rejection (e2e)', () => {
  let app: INestApplication;
  let ownerCookie: string;
  let adminCookie: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122250001');
    ownerCookie = await loginAs(app, '09122250002');

    const createRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Resubmit Test Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 8',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
    salonId = createRes.body.id;

    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'rejected', reason: 'اطلاعات ناقص است' })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a resubmit from a non-rejected status', async () => {
    const otherOwnerCookie = await loginAs(app, '09122250003');
    await request(app.getHttpServer()).post('/api/salons').set('Cookie', otherOwnerCookie).send({
      name: 'Pending Salon, not rejected',
      genderTarget: 'men',
      address: 'Somewhere St, No. 9',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
    await request(app.getHttpServer())
      .post('/api/salons/mine/resubmit')
      .set('Cookie', otherOwnerCookie)
      .expect(400);
  });

  it('flips a rejected salon back to pending and clears the reason', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/salons/mine/resubmit')
      .set('Cookie', ownerCookie)
      .expect(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.rejectionReason).toBeNull();
  });

  it('rejects an unauthenticated caller', async () =>
    request(app.getHttpServer()).post('/api/salons/mine/resubmit').expect(401));
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/api test:e2e -- salon-resubmit`
Expected: FAIL with 404 (route doesn't exist yet)

- [ ] **Step 3: Add SalonsService.resubmitMine()**

Modify `apps/api/src/salons/salons.service.ts` — add this method (place it after `updateMine`, matching the file's existing method order of create → find → update):

```typescript
  async resubmitMine(ownerId: string): Promise<Salon> {
    const salon = await this.repo.findOneBy({ ownerId });
    if (!salon) throw new NotFoundException('Salon not found');
    if (salon.status !== 'rejected') {
      throw new BadRequestException('Only a rejected salon can be resubmitted');
    }
    await this.repo.update({ id: salon.id }, { status: 'pending', rejectionReason: null });
    return (await this.repo.findOneBy({ id: salon.id }))!;
  }
```

(This method sits alongside the file's existing `createForOwner`/`findMine`/`updateMine`/`findPublicBySlug`/`findById` methods — `BadRequestException` and `NotFoundException` are already imported at the top of this file from prior work, no new import needed.)

- [ ] **Step 4: Add the controller route**

Modify `apps/api/src/salons/salons.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import { User } from '../users/user.entity';
import { CreateSalonDto, UpdateSalonDto } from './dto/salon.dto';
import { SalonsService } from './salons.service';

@Controller('salons')
export class SalonsController {
  constructor(private readonly salons: SalonsService) {}

  @Post()
  @UseGuards(AuthGuard)
  create(@Req() req: Request, @Body() dto: CreateSalonDto) {
    return this.salons.createForOwner((req.user as User).id, dto);
  }

  @Get('mine')
  @UseGuards(AuthGuard)
  mine(@Req() req: Request) {
    return this.salons.findMine((req.user as User).id);
  }

  @Patch('mine')
  @UseGuards(AuthGuard)
  update(@Req() req: Request, @Body() dto: UpdateSalonDto) {
    return this.salons.updateMine((req.user as User).id, dto);
  }

  @Post('mine/resubmit')
  @UseGuards(AuthGuard)
  resubmit(@Req() req: Request) {
    return this.salons.resubmitMine((req.user as User).id);
  }

  @Get(':slug')
  publicProfile(@Param('slug') slug: string) {
    return this.salons.findPublicBySlug(slug);
  }
}
```

(`resubmit` is registered before the wildcard `:slug` route, matching the existing file's convention of literal routes before parameterized ones.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test:e2e -- salon-resubmit`
Expected: PASS (3 tests)

- [ ] **Step 6: Run the full backend suite to confirm no regressions**

Run: `pnpm --filter @gheychi/api test:e2e`
Expected: all suites pass

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/salons/salons.controller.ts apps/api/src/salons/salons.service.ts apps/api/test/salon-resubmit.e2e-spec.ts
git commit -m "feat(api): POST /salons/mine/resubmit -- recovery path after rejection

Flips a caller's own rejected salon back to pending and clears the
rejection reason, closing the loop opened by the admin reject endpoint.
400s if the salon isn't currently rejected."
```

---

## Task 9: Backend -- GET /admin/salons/:id

**Files:**
- Modify: `apps/api/src/salons/admin-salons.controller.ts`
- Create: `apps/api/test/admin-salon-detail.e2e-spec.ts`

Task 6's `list()` only selects the fields a queue table needs (name/city/status/genderTarget/featured/createdAt). The detail view (Task 11) needs the rest (description, address, capacity, rejectionReason) to show a full salon record regardless of its status — unlike the public `GET /salons/:slug` endpoint, which only resolves `approved` salons, an admin must be able to look up a `pending`/`rejected` one too.

- [ ] **Step 1: Write the failing e2e test**

```typescript
// apps/api/test/admin-salon-detail.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin salon detail (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122260001');
    const ownerCookie = await loginAs(app, '09122260002');
    const createRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Detail Test Salon',
      description: 'یک آرایشگاه نمونه',
      genderTarget: 'women',
      address: 'Somewhere St, No. 10',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
      capacity: 3,
    });
    salonId = createRes.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the full salon record for a pending salon (not just the approved-only public fields)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/admin/salons/${salonId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toMatchObject({
      id: salonId,
      name: 'Detail Test Salon',
      description: 'یک آرایشگاه نمونه',
      status: 'pending',
      address: 'Somewhere St, No. 10',
      capacity: 3,
      rejectionReason: null,
    });
  });

  it('404s an unknown salon id', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/salons/00000000-0000-0000-0000-000000000000')
      .set('Cookie', adminCookie)
      .expect(404);
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122260099');
    await request(app.getHttpServer())
      .get(`/api/admin/salons/${salonId}`)
      .set('Cookie', customerCookie)
      .expect(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-salon-detail`
Expected: FAIL with 404 (no route yet -- NestJS's `:id/status` and `:id/featured` are more specific paths, but a bare `:id` GET doesn't exist)

- [ ] **Step 3: Add the detail route**

Modify `apps/api/src/salons/admin-salons.controller.ts` — add a `@Get(':id')` method. Place it in the class after `list()` and before `setStatus()`:

```typescript
  @Get(':id')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const salon = await this.salons.findOneBy({ id });
    if (!salon) throw new NotFoundException();
    return salon;
  }
```

(`ParseUUIDPipe`, `NotFoundException`, and `Get` are already imported at the top of this file from prior tasks.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-salon-detail`
Expected: PASS (3 tests)

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `pnpm --filter @gheychi/api test:e2e`
Expected: all suites pass (in particular, confirm `admin-salons-list` and `admin-salon-status` still pass -- `GET :id` must not shadow or be shadowed by the `GET` list route or the `PATCH :id/status`/`PATCH :id/featured` routes; NestJS matches by method+path together so a `GET :id` and `PATCH :id/status` never collide, and `GET` with no param already has its own empty-path route registered first)

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/salons/admin-salons.controller.ts apps/api/test/admin-salon-detail.e2e-spec.ts
git commit -m "feat(api): GET /admin/salons/:id -- full salon record for any status

Unlike the public GET /salons/:slug (approved-only), this resolves a
salon regardless of status so an admin can review a pending/rejected one.
Feeds the admin salon detail view in the next tasks."
```

---

## Task 10: Frontend (admin) -- salon queue list view

**Files:**
- Create: `apps/admin-panel/src/pages/SalonsView.vue`
- Modify: `apps/admin-panel/src/router/index.ts`

A plain list view (filters: status/city/name/genderTarget, each row links to the detail page) — no unit test, per the design doc's testing philosophy ("plain list/search views... stay untested," matching Provider Panel's precedent).

- [ ] **Step 1: Create SalonsView.vue**

```vue
<!-- apps/admin-panel/src/pages/SalonsView.vue -->
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'

interface SalonRow {
  id: string
  name: string
  city: string
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  genderTarget: 'women' | 'men'
  isFeatured: boolean
  createdAt: string
}

const { apiFetch } = useApi()
const salons = ref<SalonRow[]>([])
const loading = ref(true)

const statusFilter = ref<'pending' | 'approved' | 'rejected' | 'suspended'>('pending')
const cityFilter = ref('')
const nameFilter = ref('')
const genderFilter = ref<'' | 'women' | 'men'>('')

async function load() {
  loading.value = true
  const params = new URLSearchParams({ status: statusFilter.value })
  if (cityFilter.value) params.set('city', cityFilter.value)
  if (nameFilter.value) params.set('name', nameFilter.value)
  if (genderFilter.value) params.set('genderTarget', genderFilter.value)

  const { data } = await apiFetch<SalonRow[]>(`/admin/salons?${params.toString()}`, { silent: true })
  salons.value = data ?? []
  loading.value = false
}

onMounted(load)
watch([statusFilter, cityFilter, nameFilter, genderFilter], load)
</script>

<template>
  <div class="space-y-4 p-6">
    <h1 class="text-lg font-bold">آرایشگاه‌ها</h1>

    <div class="flex flex-wrap gap-3">
      <select v-model="statusFilter" data-testid="status-filter" class="rounded-lg border p-2 text-sm">
        <option value="pending">در انتظار بررسی</option>
        <option value="approved">تایید شده</option>
        <option value="rejected">رد شده</option>
        <option value="suspended">معلق</option>
      </select>
      <input v-model="cityFilter" placeholder="شهر" class="rounded-lg border p-2 text-sm" />
      <input v-model="nameFilter" placeholder="نام آرایشگاه" class="rounded-lg border p-2 text-sm" />
      <select v-model="genderFilter" class="rounded-lg border p-2 text-sm">
        <option value="">همه</option>
        <option value="women">بانوان</option>
        <option value="men">آقایان</option>
      </select>
    </div>

    <p v-if="!loading && salons.length === 0" class="text-sm text-gray-500">موردی یافت نشد.</p>

    <table v-else class="w-full text-right text-sm">
      <thead>
        <tr class="border-b text-gray-500">
          <th class="p-2">نام</th>
          <th class="p-2">شهر</th>
          <th class="p-2">مخاطب</th>
          <th class="p-2">وضعیت</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="salon in salons" :key="salon.id" class="border-b">
          <td class="p-2">
            <RouterLink :to="`/salons/${salon.id}`" class="text-(--color-accent)">{{ salon.name }}</RouterLink>
          </td>
          <td class="p-2">{{ salon.city }}</td>
          <td class="p-2">{{ salon.genderTarget === 'women' ? 'بانوان' : 'آقایان' }}</td>
          <td class="p-2">{{ salon.status }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 2: Register the route**

Modify `apps/admin-panel/src/router/index.ts` — add a child route under the `AppLayout` parent's `children` array:

```typescript
    children: [
      { path: '', name: 'dashboard', component: () => import('@/pages/DashboardView.vue') },
      { path: 'salons', name: 'salons', component: () => import('@/pages/SalonsView.vue') },
    ],
```

- [ ] **Step 3: Run the suite and typecheck**

Run: `pnpm --filter @gheychi/admin-panel test -- --run`
Expected: 5 files, 18 tests passed (unchanged -- this task adds no test file, matching the plain-list-views-stay-untested rule)

Run: `pnpm --filter @gheychi/admin-panel typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/admin-panel/src/pages/SalonsView.vue apps/admin-panel/src/router/index.ts
git commit -m "feat(admin-panel): add the salon queue list view

Filterable by status (default: pending)/city/name/genderTarget against
the admin-salons list endpoint. Plain list view, no unit test, matching
provider-panel's established testing philosophy for this category of view."
```

---

## Task 11: Frontend (admin) -- salon detail view with approve/reject/suspend actions

**Files:**
- Create: `apps/admin-panel/src/components/salons/SalonStatusActions.vue`
- Create: `apps/admin-panel/src/components/salons/SalonStatusActions.spec.ts`
- Create: `apps/admin-panel/src/pages/SalonDetailView.vue`
- Modify: `apps/admin-panel/src/router/index.ts`

`SalonStatusActions.vue` is the logic-bearing piece (reason validation, three distinct API calls) and gets a real component test. `SalonDetailView.vue` is the page wrapper (fetch + render) and doesn't, matching the same split used for `SalonsView.vue`.

- [ ] **Step 1: Write the failing test for SalonStatusActions**

```typescript
// apps/admin-panel/src/components/salons/SalonStatusActions.spec.ts
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SalonStatusActions from './SalonStatusActions.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('SalonStatusActions', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('approves with no reason required', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 's1', status: 'approved' }, error: null })
    const wrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'pending' } })

    await wrapper.get('[data-testid="approve-button"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/status', {
      method: 'PATCH',
      body: { status: 'approved' },
    })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 's1', status: 'approved' }])
  })

  it('does not submit a reject with an empty reason', async () => {
    const wrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'pending' } })

    await wrapper.get('[data-testid="reject-button"]').trigger('click')
    await wrapper.get('[data-testid="reject-submit"]').trigger('click')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.find('[data-testid="reason-error"]').exists()).toBe(true)
  })

  it('rejects with a reason once one is entered', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 's1', status: 'rejected' }, error: null })
    const wrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'pending' } })

    await wrapper.get('[data-testid="reject-button"]').trigger('click')
    await wrapper.get('[data-testid="reason-input"]').setValue('آدرس نامعتبر است')
    await wrapper.get('[data-testid="reject-submit"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/status', {
      method: 'PATCH',
      body: { status: 'rejected', reason: 'آدرس نامعتبر است' },
    })
  })

  it('only shows a suspend action when the salon is currently approved', () => {
    const pendingWrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'pending' } })
    expect(pendingWrapper.find('[data-testid="suspend-button"]').exists()).toBe(false)

    const approvedWrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'approved' } })
    expect(approvedWrapper.find('[data-testid="suspend-button"]').exists()).toBe(true)
  })

  it('suspends with a reason', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 's1', status: 'suspended' }, error: null })
    const wrapper = mount(SalonStatusActions, { props: { salonId: 's1', status: 'approved' } })

    await wrapper.get('[data-testid="suspend-button"]').trigger('click')
    await wrapper.get('[data-testid="reason-input"]').setValue('شکایت مشتری')
    await wrapper.get('[data-testid="reject-submit"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/salons/s1/status', {
      method: 'PATCH',
      body: { status: 'suspended', reason: 'شکایت مشتری' },
    })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/admin-panel test -- --run SalonStatusActions`
Expected: FAIL with "Cannot find module './SalonStatusActions.vue'"

- [ ] **Step 3: Create SalonStatusActions.vue**

```vue
<!-- apps/admin-panel/src/components/salons/SalonStatusActions.vue -->
<script setup lang="ts">
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'

const props = defineProps<{
  salonId: string
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
}>()

const emit = defineEmits<{ updated: [salon: { id: string; status: string }] }>()

const { apiFetch } = useApi()
const showReasonFor = ref<'rejected' | 'suspended' | null>(null)
const reason = ref('')
const reasonError = ref(false)

async function approve() {
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/salons/${props.salonId}/status`, {
    method: 'PATCH',
    body: { status: 'approved' },
  })
  if (data) emit('updated', data)
}

function openReason(target: 'rejected' | 'suspended') {
  showReasonFor.value = target
  reason.value = ''
  reasonError.value = false
}

async function submitReason() {
  if (!reason.value.trim()) {
    reasonError.value = true
    return
  }
  const target = showReasonFor.value!
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/salons/${props.salonId}/status`, {
    method: 'PATCH',
    body: { status: target, reason: reason.value.trim() },
  })
  if (data) {
    showReasonFor.value = null
    emit('updated', data)
  }
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="!showReasonFor" class="flex gap-2">
      <button
        v-if="status === 'pending'"
        data-testid="approve-button"
        type="button"
        class="rounded-lg bg-(--color-accent) px-4 py-2 text-sm text-white"
        @click="approve"
      >
        تایید
      </button>
      <button
        v-if="status === 'pending'"
        data-testid="reject-button"
        type="button"
        class="rounded-lg border border-red-600 px-4 py-2 text-sm text-red-600"
        @click="openReason('rejected')"
      >
        رد
      </button>
      <button
        v-if="status === 'approved'"
        data-testid="suspend-button"
        type="button"
        class="rounded-lg border border-red-600 px-4 py-2 text-sm text-red-600"
        @click="openReason('suspended')"
      >
        تعلیق
      </button>
    </div>

    <div v-else class="space-y-2">
      <textarea
        v-model="reason"
        data-testid="reason-input"
        placeholder="دلیل"
        class="w-full rounded-lg border p-2 text-sm"
      />
      <p v-if="reasonError" data-testid="reason-error" class="text-sm text-red-600">وارد کردن دلیل الزامی است.</p>
      <div class="flex gap-2">
        <button
          data-testid="reject-submit"
          type="button"
          class="rounded-lg bg-red-600 px-4 py-2 text-sm text-white"
          @click="submitReason"
        >
          ثبت
        </button>
        <button type="button" class="rounded-lg border px-4 py-2 text-sm" @click="showReasonFor = null">
          انصراف
        </button>
      </div>
    </div>
  </div>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gheychi/admin-panel test -- --run SalonStatusActions`
Expected: PASS (5 tests)

- [ ] **Step 5: Create SalonDetailView.vue**

```vue
<!-- apps/admin-panel/src/pages/SalonDetailView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '@/composables/useApi'
import SalonStatusActions from '@/components/salons/SalonStatusActions.vue'

interface SalonDetail {
  id: string
  name: string
  description: string | null
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  genderTarget: 'women' | 'men'
  address: string
  city: string
  capacity: number
  rejectionReason: string | null
}

const route = useRoute()
const { apiFetch } = useApi()
const salon = ref<SalonDetail | null>(null)
const notFound = ref(false)

async function load() {
  const { data, error } = await apiFetch<SalonDetail>(`/admin/salons/${route.params.id}`, { silent: true })
  if (!data) {
    notFound.value = true
    return
  }
  salon.value = data
  notFound.value = !!error
}

function onUpdated(updated: { id: string; status: string }) {
  if (salon.value) salon.value.status = updated.status as SalonDetail['status']
  load()
}

onMounted(load)
</script>

<template>
  <div class="space-y-4 p-6">
    <p v-if="notFound" class="text-sm text-red-600">آرایشگاه یافت نشد.</p>
    <template v-else-if="salon">
      <h1 class="text-lg font-bold">{{ salon.name }}</h1>
      <p class="text-sm text-gray-500">{{ salon.city }} — {{ salon.address }}</p>
      <p v-if="salon.description" class="text-sm">{{ salon.description }}</p>
      <p class="text-sm">ظرفیت همزمان: {{ salon.capacity }}</p>
      <p class="text-sm">وضعیت: {{ salon.status }}</p>
      <p v-if="salon.rejectionReason" class="text-sm text-red-600">دلیل: {{ salon.rejectionReason }}</p>

      <SalonStatusActions :salon-id="salon.id" :status="salon.status" @updated="onUpdated" />
    </template>
  </div>
</template>
```

- [ ] **Step 6: Register the route**

Modify `apps/admin-panel/src/router/index.ts` — add another child route:

```typescript
    children: [
      { path: '', name: 'dashboard', component: () => import('@/pages/DashboardView.vue') },
      { path: 'salons', name: 'salons', component: () => import('@/pages/SalonsView.vue') },
      { path: 'salons/:id', name: 'salon-detail', component: () => import('@/pages/SalonDetailView.vue') },
    ],
```

- [ ] **Step 7: Run the full suite and typecheck**

Run: `pnpm --filter @gheychi/admin-panel test -- --run`
Expected: 6 files, 23 tests passed

Run: `pnpm --filter @gheychi/admin-panel typecheck`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/admin-panel/src/components/salons apps/admin-panel/src/pages/SalonDetailView.vue apps/admin-panel/src/router/index.ts
git commit -m "feat(admin-panel): add salon detail view with approve/reject/suspend

SalonStatusActions.vue is the logic-bearing piece (reason required for
reject/suspend, three distinct status transitions) and gets a real
component test; SalonDetailView.vue is a plain fetch+render wrapper and
doesn't, matching the same split as SalonsView.vue. Closes Slice 1's
admin-facing half."
```

---

## Task 12: Backend + Frontend (Provider Panel) -- Salon Settings page

**Files:**
- Modify: `apps/api/src/salons/dto/salon.dto.ts`
- Create/modify: `apps/api/src/salons/salons.service.spec.ts`
- Create: `apps/provider-panel/src/pages/SalonSettingsView.vue`
- Create: `apps/provider-panel/src/pages/SalonSettingsView.spec.ts`
- Modify: `apps/provider-panel/src/router/index.ts`
- Modify: `apps/provider-panel/src/pages/DashboardView.vue`

`UpdateSalonDto` currently omits `genderTarget` (only `CreateSalonDto` has it), so a Settings page reusing `SalonInfoStep.vue`'s full model (which includes `genderTarget`) would silently fail to save that field. This task adds it to the DTO first, then builds the page.

- [ ] **Step 1: Write the failing unit test for the DTO gap**

Since `UpdateSalonDto` is pure declarative `class-validator` decorators with no service-level logic of its own, the test that actually proves the gap lives at the point where it's used: `SalonsService.updateMine()`. Create `apps/api/src/salons/salons.service.spec.ts` (this file doesn't exist yet — this task adds the first unit test for this service; TypeORM repository is mocked, matching the pattern already used in `apps/api/src/storage/local-disk-storage.provider.spec.ts` and `apps/api/src/booking/bookings.service.spec.ts` for constructor-injected dependencies):

```typescript
// apps/api/src/salons/salons.service.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Salon } from './salon.entity';
import { SalonsService } from './salons.service';

describe('SalonsService.updateMine', () => {
  let service: SalonsService;
  let repo: { findOneBy: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    repo = { findOneBy: jest.fn(), save: jest.fn((s) => s) };
    const moduleRef = await Test.createTestingModule({
      providers: [SalonsService, { provide: getRepositoryToken(Salon), useValue: repo }],
    }).compile();
    service = moduleRef.get(SalonsService);
  });

  it('applies a genderTarget change', async () => {
    repo.findOneBy.mockResolvedValue({ id: 's1', ownerId: 'u1', genderTarget: 'women' } as Salon);
    const result = await service.updateMine('u1', { genderTarget: 'men' });
    expect(result.genderTarget).toBe('men');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/api test -- salons.service`
Expected: FAIL -- TypeScript error, `genderTarget` isn't a valid property of `UpdateSalonDto`'s type (or, if TS is lenient enough to let the object literal through, the assertion fails because the field is silently dropped)

- [ ] **Step 3: Add genderTarget to UpdateSalonDto**

Modify `apps/api/src/salons/dto/salon.dto.ts`:

```typescript
export class UpdateSalonDto {
  @IsOptional() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsIn(['women', 'men']) genderTarget?: 'women' | 'men';
  @IsOptional() @IsString() @Length(5, 500) address?: string;
  @IsOptional() @IsString() @Length(2, 80) city?: string;
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) capacity?: number;
}
```

(`IsIn` is already imported at the top of this file for `CreateSalonDto.genderTarget` — no new import needed. `SalonsService.updateMine()`'s `Object.assign(salon, rest)` already picks up any field present on the DTO with zero service-code changes.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test -- salons.service`
Expected: PASS (1 test)

- [ ] **Step 5: Run the full backend suite to confirm no regressions**

Run: `pnpm --filter @gheychi/api test && pnpm --filter @gheychi/api test:e2e`
Expected: all suites pass

- [ ] **Step 6: Commit the backend change**

```bash
git add apps/api/src/salons/dto/salon.dto.ts apps/api/src/salons/salons.service.spec.ts
git commit -m "fix(api): allow genderTarget in PATCH /salons/mine

UpdateSalonDto omitted genderTarget (only CreateSalonDto had it), which
would have silently no-op'd it from the new Provider Panel Salon Settings
page in the next commit. updateMine()'s Object.assign already handles any
field present on the DTO -- only the DTO itself needed the field added."
```

- [ ] **Step 7: Write the failing test for SalonSettingsView**

```typescript
// apps/provider-panel/src/pages/SalonSettingsView.spec.ts
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SalonSettingsView from './SalonSettingsView.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('SalonSettingsView', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('loads the current salon info and saves an edit', async () => {
    fetchMock.mockResolvedValueOnce({
      data: {
        id: 's1',
        name: 'سالن قدیمی',
        description: '',
        genderTarget: 'women',
        address: 'خیابان آزادی',
        city: 'تهران',
        capacity: 2,
        lat: 35.7,
        lng: 51.4,
      },
      error: null,
    })
    const wrapper = mount(SalonSettingsView)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.get('[data-testid="salon-name"]').element as HTMLInputElement).toHaveProperty('value', 'سالن قدیمی')

    fetchMock.mockResolvedValueOnce({ data: { id: 's1' }, error: null })
    await wrapper.get('[data-testid="salon-name"]').setValue('سالن جدید')
    await wrapper.get('[data-testid="save-button"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/salons/mine', {
      method: 'PATCH',
      body: expect.objectContaining({ name: 'سالن جدید' }),
    })
  })
})
```

- [ ] **Step 8: Run it to verify it fails**

Run: `pnpm --filter @gheychi/provider-panel test -- --run SalonSettingsView`
Expected: FAIL with "Cannot find module './SalonSettingsView.vue'"

- [ ] **Step 9: Create SalonSettingsView.vue**

```vue
<!-- apps/provider-panel/src/pages/SalonSettingsView.vue -->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import SalonInfoStep from '@/components/onboarding/SalonInfoStep.vue'

const { apiFetch } = useApi()
const loaded = ref(false)
const saving = ref(false)

const form = reactive({
  name: '',
  description: '',
  genderTarget: '' as 'women' | 'men' | '',
  address: '',
  city: '',
  capacity: 1,
  lat: null as number | null,
  lng: null as number | null,
})

async function load() {
  const { data } = await apiFetch<typeof form>('/salons/mine', { silent: true })
  if (data) Object.assign(form, data)
  loaded.value = true
}

async function save() {
  saving.value = true
  await apiFetch('/salons/mine', {
    method: 'PATCH',
    body: {
      name: form.name,
      description: form.description || undefined,
      genderTarget: form.genderTarget || undefined,
      address: form.address,
      city: form.city,
      capacity: form.capacity,
      lat: form.lat ?? undefined,
      lng: form.lng ?? undefined,
    },
  })
  saving.value = false
}

onMounted(load)
</script>

<template>
  <div v-if="loaded" class="space-y-4 p-4">
    <h1 class="text-lg font-bold">تنظیمات آرایشگاه</h1>
    <SalonInfoStep v-model="form" />
    <button
      data-testid="save-button"
      type="button"
      :disabled="saving"
      class="w-full rounded-lg bg-(--color-accent) p-3 text-white"
      @click="save"
    >
      ذخیره
    </button>
  </div>
</template>
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm --filter @gheychi/provider-panel test -- --run SalonSettingsView`
Expected: PASS (1 test)

- [ ] **Step 11: Register the route and link it from the dashboard**

Modify `apps/provider-panel/src/router/index.ts` — add a child route alongside `hours`/`photos`:

```typescript
      { path: 'hours', name: 'hours', component: () => import('@/pages/HoursView.vue') },
      { path: 'photos', name: 'photos', component: () => import('@/pages/PhotosView.vue') },
      { path: 'settings', name: 'settings', component: () => import('@/pages/SalonSettingsView.vue') },
```

Modify `apps/provider-panel/src/pages/DashboardView.vue` — add a link next to the existing "ساعات کاری"/"تصاویر" links (inside the `<div class="flex gap-3 text-sm">` block):

```vue
      <div class="flex gap-3 text-sm">
        <RouterLink to="/hours">ساعات کاری</RouterLink>
        <RouterLink to="/photos">تصاویر</RouterLink>
        <RouterLink to="/settings">تنظیمات</RouterLink>
      </div>
```

- [ ] **Step 12: Run the full provider-panel suite and typecheck**

Run: `pnpm --filter @gheychi/provider-panel test -- --run`
Expected: 12 files, 36 tests passed

Run: `pnpm --filter @gheychi/provider-panel typecheck`
Expected: no errors

- [ ] **Step 13: Commit**

```bash
git add apps/provider-panel/src/pages/SalonSettingsView.vue apps/provider-panel/src/pages/SalonSettingsView.spec.ts apps/provider-panel/src/router/index.ts apps/provider-panel/src/pages/DashboardView.vue
git commit -m "feat(provider-panel): add a Salon Settings page

Reuses SalonInfoStep.vue's existing form in a standalone edit context,
bound to PATCH /salons/mine. Reachable from Dashboard alongside Hours and
Photos. Gives a rejected provider (Task 13) somewhere to actually go fix
their salon info before resubmitting."
```

---

## Task 13: Frontend (Provider Panel) -- rejected-status recovery flow

**Files:**
- Modify: `apps/provider-panel/src/pages/PendingApprovalView.vue`
- Modify: `apps/provider-panel/src/pages/PendingApprovalView.spec.ts`

Adds a `rejected` branch to the existing `pending`/`suspended` conditional, showing the admin's reason plus a link to Settings and a resubmit button. Closes Slice 1.

- [ ] **Step 1: Read the existing test file and extend it**

`apps/provider-panel/src/pages/PendingApprovalView.spec.ts` already exists from Plan 5 (Task 12) with tests for the `pending` and `suspended` branches. Add a new `describe` block covering `rejected`, following that file's existing pattern of mounting with a mocked `useSalon`:

```typescript
  describe('when the salon is rejected', () => {
    it('shows the rejection reason and a resubmit action', async () => {
      salonRef.value = {
        id: 's1', name: 'x', slug: 'x', status: 'rejected', genderTarget: 'women',
        address: 'x', city: 'x', capacity: 1, rejectionReason: 'آدرس نامعتبر است',
      }
      fetchMock.mockResolvedValueOnce({ data: { id: 's1', status: 'pending' }, error: null })

      const wrapper = mountView()
      expect(wrapper.text()).toContain('آدرس نامعتبر است')
      expect(wrapper.find('[data-testid="resubmit-button"]').exists()).toBe(true)

      await wrapper.get('[data-testid="resubmit-button"]').trigger('click')
      expect(fetchMock).toHaveBeenCalledWith('/salons/mine/resubmit', { method: 'POST' })
    })
  })
```

(This snippet assumes the existing file's helper names `salonRef`/`fetchMock`/`mountView` — read the actual file first and adapt the variable names to whatever it already uses; the assertions and mocked call are what matter, not the exact scaffolding names.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/provider-panel test -- --run PendingApprovalView`
Expected: FAIL -- no rejection reason or resubmit button rendered yet

- [ ] **Step 3: Update PendingApprovalView.vue**

```vue
<script setup lang="ts">
import { useSalon } from '@/composables/useSalon'
import { useApi } from '@/composables/useApi'

const { salon, refetch } = useSalon()
const { apiFetch } = useApi()

async function resubmit() {
  const { data } = await apiFetch('/salons/mine/resubmit', { method: 'POST' })
  if (data) await refetch()
}
</script>

<template>
  <div class="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
    <template v-if="salon?.status === 'rejected'">
      <h1 class="text-xl font-bold">درخواست شما رد شد</h1>
      <p v-if="salon.rejectionReason" class="text-sm text-red-600">{{ salon.rejectionReason }}</p>
      <RouterLink to="/settings" class="text-sm text-(--color-accent)">ویرایش اطلاعات آرایشگاه</RouterLink>
      <button data-testid="resubmit-button" type="button" class="rounded-lg border px-4 py-2" @click="resubmit">
        ارسال مجدد برای بررسی
      </button>
    </template>
    <template v-else>
      <h1 class="text-xl font-bold">
        {{ salon?.status === 'suspended' ? 'آرایشگاه شما معلق شده است' : 'آرایشگاه شما در حال بررسی است' }}
      </h1>
      <p class="text-sm">
        {{
          salon?.status === 'suspended'
            ? 'برای اطلاعات بیشتر با پشتیبانی تماس بگیرید.'
            : 'به محض تایید توسط تیم آرایشگاه، به شما اطلاع داده می‌شود.'
        }}
      </p>
      <button data-testid="refresh-status" type="button" class="rounded-lg border px-4 py-2" @click="refetch">
        بررسی وضعیت
      </button>
    </template>
  </div>
</template>
```

- [ ] **Step 4: Update the Salon interface to include rejectionReason**

Modify `apps/provider-panel/src/composables/useSalon.ts` — add the field to the `Salon` interface:

```typescript
export interface Salon {
  id: string
  name: string
  slug: string
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  genderTarget: 'women' | 'men'
  address: string
  city: string
  capacity: number
  rejectionReason: string | null
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @gheychi/provider-panel test -- --run PendingApprovalView`
Expected: PASS

- [ ] **Step 6: Run the full provider-panel suite and typecheck**

Run: `pnpm --filter @gheychi/provider-panel test -- --run`
Expected: 12 files, 37 tests passed

Run: `pnpm --filter @gheychi/provider-panel typecheck`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add apps/provider-panel/src/pages/PendingApprovalView.vue apps/provider-panel/src/pages/PendingApprovalView.spec.ts apps/provider-panel/src/composables/useSalon.ts
git commit -m "feat(provider-panel): show rejection reason and a resubmit action

Closes the loop opened by the admin reject endpoint: a rejected provider
now sees why, a link to Settings (added last task) to fix it, and a
resubmit button that flips the salon back to pending. This is the last
piece of Slice 1 -- salon approval no longer needs a manual SQL update
anywhere in the flow."
```

---

## Task 14: Backend -- GET /admin/reviews

**Files:**
- Modify: `apps/api/src/reviews/reviews.service.ts`
- Modify: `apps/api/src/reviews/admin-reviews.controller.ts`
- Create: `apps/api/src/reviews/dto/admin-review-query.dto.ts`
- Create: `apps/api/test/admin-reviews-list.e2e-spec.ts`

Slice 2 starts here. `PATCH /admin/reviews/:id` (moderation itself) already exists from Plan 3 — this is the only missing piece: a way for an admin to find the review a report was about. Filterable by `salonId`/`status`/`rating`.

- [ ] **Step 1: Write the failing e2e test**

```typescript
// apps/api/test/admin-reviews-list.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin reviews list (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let salonId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122270001');

    const ownerCookie = await loginAs(app, '09122270002');
    const salonRes = await request(app.getHttpServer()).post('/api/salons').set('Cookie', ownerCookie).send({
      name: 'Reviewed Salon',
      genderTarget: 'women',
      address: 'Somewhere St, No. 11',
      city: 'Tehran',
      lat: 35.7,
      lng: 51.4,
    });
    salonId = salonRes.body.id;
    await request(app.getHttpServer())
      .patch(`/api/admin/salons/${salonId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' })
      .expect(200);

    // Directly seed two reviews via the repository -- creating them through the real
    // create-a-review flow would require a full completed booking per review, which is
    // unrelated to what this endpoint needs to prove (it only reads). This mirrors how
    // other e2e specs in this codebase seed fixture rows directly when the thing under
    // test is downstream of, not the creation flow itself.
    const dataSource = app.get('DataSource');
    await dataSource.query(
      `INSERT INTO users (id, phone, role) VALUES ('00000000-0000-0000-0000-0000000000a1', '09122270099', 'customer')`,
    );
    await dataSource.query(
      `INSERT INTO bookings (id, salon_id, service_id, user_id, starts_at, ends_at, status, price_snapshot, deposit_amount)
       SELECT '00000000-0000-0000-0000-0000000000b1', $1, id, '00000000-0000-0000-0000-0000000000a1', now(), now(), 'completed', 100000, 20000
       FROM salon_services WHERE salon_id = $1 LIMIT 1`,
      [salonId],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists reviews filtered by salonId', async () => {
    const dataSource = app.get('DataSource');
    await dataSource.query(
      `INSERT INTO reviews (id, booking_id, salon_id, user_id, rating, comment, status)
       VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1', $1, '00000000-0000-0000-0000-0000000000a1', 4, 'خوب بود', 'published')`,
      [salonId],
    );

    const res = await request(app.getHttpServer())
      .get(`/api/admin/reviews?salonId=${salonId}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].comment).toBe('خوب بود');
  });

  it('filters by status', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/reviews?status=rejected')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(0);
  });

  it('filters by rating', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/reviews?rating=4')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122270098');
    await request(app.getHttpServer()).get('/api/admin/reviews').set('Cookie', customerCookie).expect(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-reviews-list`
Expected: FAIL with 404 (no route yet)

- [ ] **Step 3: Create the query DTO**

```typescript
// apps/api/src/reviews/dto/admin-review-query.dto.ts
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class AdminReviewQueryDto {
  @IsOptional()
  @IsUUID()
  salonId?: string;

  @IsOptional()
  @IsIn(['published', 'rejected'])
  status?: 'published' | 'rejected';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;
}
```

- [ ] **Step 4: Add ReviewsService.listForAdmin()**

Modify `apps/api/src/reviews/reviews.service.ts` — add this method after `findForSalon` (unlike `findForSalon`, which is scoped to `published` only for the public-facing salon page, this has no status filter by default, since an admin specifically needs to see rejected reviews too):

```typescript
  listForAdmin(query: { salonId?: string; status?: 'published' | 'rejected'; rating?: number }): Promise<Review[]> {
    const where: Record<string, unknown> = {};
    if (query.salonId) where.salonId = query.salonId;
    if (query.status) where.status = query.status;
    if (query.rating) where.rating = query.rating;
    return this.reviews.find({ where, order: { createdAt: 'DESC' } });
  }
```

- [ ] **Step 5: Add the controller route**

Modify `apps/api/src/reviews/admin-reviews.controller.ts`:

```typescript
import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminReviewQueryDto } from './dto/admin-review-query.dto';
import { ModerateReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@Controller('admin/reviews')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  list(@Query() query: AdminReviewQueryDto) {
    return this.reviews.listForAdmin(query);
  }

  @Patch(':id')
  moderate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerateReviewDto) {
    return this.reviews.moderate(id, dto.status);
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-reviews-list`
Expected: PASS (4 tests)

- [ ] **Step 7: Run the full backend suite to confirm no regressions**

Run: `pnpm --filter @gheychi/api test:e2e`
Expected: all suites pass

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/reviews/reviews.service.ts apps/api/src/reviews/admin-reviews.controller.ts apps/api/src/reviews/dto/admin-review-query.dto.ts apps/api/test/admin-reviews-list.e2e-spec.ts
git commit -m "feat(api): GET /admin/reviews -- filterable by salon/status/rating

The moderation action itself (PATCH /admin/reviews/:id) already existed
from Plan 3; this is the only missing piece, letting an admin find the
review a report was about (reports still arrive out-of-band, unchanged)."
```

---

## Task 15: Frontend (admin) -- review moderation view

**Files:**
- Create: `apps/admin-panel/src/components/reviews/ModerateReviewButton.vue`
- Create: `apps/admin-panel/src/components/reviews/ModerateReviewButton.spec.ts`
- Create: `apps/admin-panel/src/pages/ReviewsView.vue`
- Modify: `apps/admin-panel/src/router/index.ts`

Same split as Slice 1: `ModerateReviewButton.vue` is logic-bearing (the moderate action) and gets a test; `ReviewsView.vue` is a plain filterable list and doesn't.

- [ ] **Step 1: Write the failing test for ModerateReviewButton**

```typescript
// apps/admin-panel/src/components/reviews/ModerateReviewButton.spec.ts
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ModerateReviewButton from './ModerateReviewButton.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('ModerateReviewButton', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('shows a reject action for a published review and calls the moderate endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'r1', status: 'rejected' }, error: null })
    const wrapper = mount(ModerateReviewButton, { props: { reviewId: 'r1', status: 'published' } })

    expect(wrapper.find('[data-testid="reject-review"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="republish-review"]').exists()).toBe(false)

    await wrapper.get('[data-testid="reject-review"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/reviews/r1', { method: 'PATCH', body: { status: 'rejected' } })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'r1', status: 'rejected' }])
  })

  it('shows a republish action for a rejected review and calls the moderate endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'r1', status: 'published' }, error: null })
    const wrapper = mount(ModerateReviewButton, { props: { reviewId: 'r1', status: 'rejected' } })

    expect(wrapper.find('[data-testid="republish-review"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="reject-review"]').exists()).toBe(false)

    await wrapper.get('[data-testid="republish-review"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/reviews/r1', { method: 'PATCH', body: { status: 'published' } })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/admin-panel test -- --run ModerateReviewButton`
Expected: FAIL with "Cannot find module './ModerateReviewButton.vue'"

- [ ] **Step 3: Create ModerateReviewButton.vue**

```vue
<!-- apps/admin-panel/src/components/reviews/ModerateReviewButton.vue -->
<script setup lang="ts">
import { useApi } from '@/composables/useApi'

const props = defineProps<{ reviewId: string; status: 'published' | 'rejected' }>()
const emit = defineEmits<{ updated: [review: { id: string; status: string }] }>()

const { apiFetch } = useApi()

async function toggle() {
  const target = props.status === 'published' ? 'rejected' : 'published'
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/reviews/${props.reviewId}`, {
    method: 'PATCH',
    body: { status: target },
  })
  if (data) emit('updated', data)
}
</script>

<template>
  <button
    v-if="status === 'published'"
    data-testid="reject-review"
    type="button"
    class="rounded-lg border border-red-600 px-3 py-1 text-sm text-red-600"
    @click="toggle"
  >
    رد نظر
  </button>
  <button
    v-else
    data-testid="republish-review"
    type="button"
    class="rounded-lg bg-(--color-accent) px-3 py-1 text-sm text-white"
    @click="toggle"
  >
    انتشار مجدد
  </button>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gheychi/admin-panel test -- --run ModerateReviewButton`
Expected: PASS (2 tests)

- [ ] **Step 5: Create ReviewsView.vue**

```vue
<!-- apps/admin-panel/src/pages/ReviewsView.vue -->
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import ModerateReviewButton from '@/components/reviews/ModerateReviewButton.vue'

interface ReviewRow {
  id: string
  salonId: string
  rating: number
  comment: string | null
  status: 'published' | 'rejected'
  salonReply: string | null
}

const { apiFetch } = useApi()
const reviews = ref<ReviewRow[]>([])
const loading = ref(true)

const salonIdFilter = ref('')
const statusFilter = ref<'' | 'published' | 'rejected'>('')
const ratingFilter = ref<'' | number>('')

async function load() {
  loading.value = true
  const params = new URLSearchParams()
  if (salonIdFilter.value) params.set('salonId', salonIdFilter.value)
  if (statusFilter.value) params.set('status', statusFilter.value)
  if (ratingFilter.value) params.set('rating', String(ratingFilter.value))

  const { data } = await apiFetch<ReviewRow[]>(`/admin/reviews?${params.toString()}`, { silent: true })
  reviews.value = data ?? []
  loading.value = false
}

function onUpdated(reviewId: string, status: string) {
  const review = reviews.value.find((r) => r.id === reviewId)
  if (review) review.status = status as ReviewRow['status']
}

onMounted(load)
watch([salonIdFilter, statusFilter, ratingFilter], load)
</script>

<template>
  <div class="space-y-4 p-6">
    <h1 class="text-lg font-bold">نظرات</h1>

    <div class="flex flex-wrap gap-3">
      <input v-model="salonIdFilter" placeholder="شناسه آرایشگاه" class="rounded-lg border p-2 text-sm" />
      <select v-model="statusFilter" class="rounded-lg border p-2 text-sm">
        <option value="">همه</option>
        <option value="published">منتشر شده</option>
        <option value="rejected">رد شده</option>
      </select>
      <select v-model="ratingFilter" class="rounded-lg border p-2 text-sm">
        <option value="">همه امتیازها</option>
        <option v-for="n in [1, 2, 3, 4, 5]" :key="n" :value="n">{{ n }} ستاره</option>
      </select>
    </div>

    <p v-if="!loading && reviews.length === 0" class="text-sm text-gray-500">موردی یافت نشد.</p>

    <div v-for="review in reviews" :key="review.id" class="space-y-1 rounded-lg border p-3">
      <p class="text-sm">امتیاز: {{ review.rating }} — وضعیت: {{ review.status }}</p>
      <p v-if="review.comment" class="text-sm">{{ review.comment }}</p>
      <p v-if="review.salonReply" class="text-sm text-gray-500">پاسخ آرایشگاه: {{ review.salonReply }}</p>
      <ModerateReviewButton
        :review-id="review.id"
        :status="review.status"
        @updated="(r) => onUpdated(r.id, r.status)"
      />
    </div>
  </div>
</template>
```

- [ ] **Step 6: Register the route**

Modify `apps/admin-panel/src/router/index.ts`:

```typescript
      { path: 'reviews', name: 'reviews', component: () => import('@/pages/ReviewsView.vue') },
```

- [ ] **Step 7: Run the full suite and typecheck**

Run: `pnpm --filter @gheychi/admin-panel test -- --run`
Expected: 7 files, 25 tests passed

Run: `pnpm --filter @gheychi/admin-panel typecheck`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/admin-panel/src/components/reviews apps/admin-panel/src/pages/ReviewsView.vue apps/admin-panel/src/router/index.ts
git commit -m "feat(admin-panel): add the review moderation view

ModerateReviewButton.vue toggles published<->rejected and gets a real
test; ReviewsView.vue is a plain filterable list and doesn't, same split
as Slice 1. Closes Slice 2."
```

---

## Task 16: Backend -- create/rename categories

**Files:**
- Modify: `apps/api/src/catalog/catalog.module.ts`
- Create: `apps/api/src/catalog/admin-categories.controller.ts`
- Create: `apps/api/src/catalog/dto/category.dto.ts`
- Create: `apps/api/test/admin-categories.e2e-spec.ts`

Slice 3 starts here. No delete endpoint — `salon_services.category_id` has a FK to `service_categories`, so deleting a category in use needs a restrict-or-cascade decision this plan deliberately doesn't make (per the design doc). Create + rename only.

- [ ] **Step 1: Write the failing e2e test**

```typescript
// apps/api/test/admin-categories.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin categories (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122280001');
  });

  afterAll(async () => {
    await app.close();
  });

  let categoryId: number;

  it('creates a category', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Cookie', adminCookie)
      .send({ name: 'میکاپ عروس', icon: '💄' })
      .expect(201);
    expect(res.body).toMatchObject({ name: 'میکاپ عروس', icon: '💄' });
    categoryId = res.body.id;
  });

  it('rejects a duplicate name', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Cookie', adminCookie)
      .send({ name: 'میکاپ عروس', icon: '💄' })
      .expect(409);
  });

  it('renames a category', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/categories/${categoryId}`)
      .set('Cookie', adminCookie)
      .send({ name: 'میکاپ و شینیون عروس' })
      .expect(200);
    expect(res.body.name).toBe('میکاپ و شینیون عروس');
  });

  it('404s an unknown category id', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/categories/999999')
      .set('Cookie', adminCookie)
      .send({ name: 'x' })
      .expect(404);
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122280099');
    await request(app.getHttpServer())
      .post('/api/admin/categories')
      .set('Cookie', customerCookie)
      .send({ name: 'x', icon: 'x' })
      .expect(403);
  });

  it('confirms the public GET /categories reflects the change', async () => {
    const res = await request(app.getHttpServer()).get('/api/categories').expect(200);
    expect(res.body.find((c: { id: number }) => c.id === categoryId).name).toBe('میکاپ و شینیون عروس');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-categories`
Expected: FAIL with 404 (routes don't exist yet)

- [ ] **Step 3: Create the DTOs**

```typescript
// apps/api/src/catalog/dto/category.dto.ts
import { IsOptional, IsString, Length } from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @Length(1, 100)
  name: string;

  @IsString()
  @Length(1, 20)
  icon: string;
}

export class UpdateCategoryDto {
  @IsOptional() @IsString() @Length(1, 100) name?: string;
  @IsOptional() @IsString() @Length(1, 20) icon?: string;
}
```

- [ ] **Step 4: Create the admin controller**

```typescript
// apps/api/src/catalog/admin-categories.controller.ts
import { Body, ConflictException, Controller, NotFoundException, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { CreateCategoryDto, UpdateCategoryDto } from './dto/category.dto';
import { ServiceCategory } from './service-category.entity';

@Controller('admin/categories')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminCategoriesController {
  constructor(@InjectRepository(ServiceCategory) private readonly categories: Repository<ServiceCategory>) {}

  @Post()
  async create(@Body() dto: CreateCategoryDto) {
    try {
      return await this.categories.save(this.categories.create(dto));
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('A category with this name already exists');
      throw err;
    }
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCategoryDto) {
    const result = await this.categories.update({ id }, dto);
    if (!result.affected) throw new NotFoundException();
    return this.categories.findOneBy({ id });
  }
}
```

(`isUniqueViolation` already exists at `apps/api/src/common/postgres-error-codes.ts`, used the same way by `ReviewsService.create` — no new helper needed.)

- [ ] **Step 5: Register the controller**

Modify `apps/api/src/catalog/catalog.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminCategoriesController } from './admin-categories.controller';
import { CatalogController } from './catalog.controller';
import { ServiceCategory } from './service-category.entity';

@Module({
  imports: [TypeOrmModule.forFeature([ServiceCategory]), AuthModule],
  controllers: [CatalogController, AdminCategoriesController],
  exports: [TypeOrmModule],
})
export class CatalogModule {}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-categories`
Expected: PASS (6 tests)

- [ ] **Step 7: Run the full backend suite to confirm no regressions**

Run: `pnpm --filter @gheychi/api test:e2e`
Expected: all suites pass

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/catalog apps/api/test/admin-categories.e2e-spec.ts
git commit -m "feat(api): POST/PATCH /admin/categories -- create and rename

No delete -- salon_services.category_id has a FK to service_categories,
so removing a category in use needs a restrict-or-cascade decision this
plan deliberately doesn't make. Duplicate names 409 via the DB's existing
UNIQUE constraint, translated the same way ReviewsService.create() does."
```

---

## Task 17: Frontend (admin) -- categories view

**Files:**
- Create: `apps/admin-panel/src/pages/CategoriesView.vue`
- Modify: `apps/admin-panel/src/router/index.ts`

A single plain view (list + inline add + inline rename) — no unit test, matching the design doc's testing scope (only salon-status, review-moderation, and user-suspend actions were called out as needing component tests; categories and config stay untested like `SalonsView`/`ReviewsView`'s list portions).

- [ ] **Step 1: Create CategoriesView.vue**

```vue
<!-- apps/admin-panel/src/pages/CategoriesView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'

interface Category {
  id: number
  name: string
  icon: string
}

const { apiFetch } = useApi()
const categories = ref<Category[]>([])
const newName = ref('')
const newIcon = ref('')
const editingId = ref<number | null>(null)
const editName = ref('')

async function load() {
  const { data } = await apiFetch<Category[]>('/categories', { silent: true })
  categories.value = data ?? []
}

async function add() {
  const { data } = await apiFetch<Category>('/admin/categories', {
    method: 'POST',
    body: { name: newName.value, icon: newIcon.value },
  })
  if (data) {
    categories.value.push(data)
    newName.value = ''
    newIcon.value = ''
  }
}

function startEdit(category: Category) {
  editingId.value = category.id
  editName.value = category.name
}

async function saveEdit() {
  const { data } = await apiFetch<Category>(`/admin/categories/${editingId.value}`, {
    method: 'PATCH',
    body: { name: editName.value },
  })
  if (data) {
    const category = categories.value.find((c) => c.id === data.id)
    if (category) category.name = data.name
    editingId.value = null
  }
}

onMounted(load)
</script>

<template>
  <div class="space-y-4 p-6">
    <h1 class="text-lg font-bold">دسته‌بندی‌ها</h1>

    <ul class="space-y-2">
      <li v-for="category in categories" :key="category.id" class="flex items-center gap-3 rounded-lg border p-2">
        <span>{{ category.icon }}</span>
        <input v-if="editingId === category.id" v-model="editName" class="flex-1 rounded border p-1 text-sm" />
        <span v-else class="flex-1">{{ category.name }}</span>
        <button v-if="editingId === category.id" type="button" class="text-sm text-(--color-accent)" @click="saveEdit">
          ذخیره
        </button>
        <button v-else type="button" class="text-sm text-(--color-accent)" @click="startEdit(category)">
          ویرایش
        </button>
      </li>
    </ul>

    <form class="flex gap-2" @submit.prevent="add">
      <input v-model="newIcon" placeholder="آیکون" class="w-20 rounded-lg border p-2 text-sm" />
      <input v-model="newName" placeholder="نام دسته‌بندی جدید" class="flex-1 rounded-lg border p-2 text-sm" />
      <button type="submit" class="rounded-lg bg-(--color-accent) px-4 py-2 text-sm text-white">افزودن</button>
    </form>
  </div>
</template>
```

- [ ] **Step 2: Register the route**

Modify `apps/admin-panel/src/router/index.ts`:

```typescript
      { path: 'categories', name: 'categories', component: () => import('@/pages/CategoriesView.vue') },
```

- [ ] **Step 3: Run the suite and typecheck**

Run: `pnpm --filter @gheychi/admin-panel test -- --run`
Expected: 7 files, 25 tests passed (unchanged -- no test file added)

Run: `pnpm --filter @gheychi/admin-panel typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/admin-panel/src/pages/CategoriesView.vue apps/admin-panel/src/router/index.ts
git commit -m "feat(admin-panel): add the categories view

List + inline add + inline rename, no delete. Plain view, no unit test,
matching the design doc's testing scope. Closes Slice 3."
```

---

## Task 18: Backend -- User.status column and login-time suspend check

**Files:**
- Create: `apps/api/src/migrations/1752300000000-user-status.ts`
- Modify: `apps/api/src/users/user.entity.ts`
- Modify: `apps/api/src/auth/auth.controller.ts`
- Modify: `apps/api/src/auth/auth.guard.ts`
- Modify: `apps/api/src/auth/auth.controller.spec.ts` (create if it doesn't exist yet)
- Create: `apps/api/test/user-suspend-login.e2e-spec.ts`

Slice 4 starts here. The check happens in two places: `verify-otp` (blocks a suspended user from ever getting a new session) and `AuthGuard` (immediately locks out a user suspended mid-session, since their existing cookie is still otherwise valid for up to 30 days).

- [ ] **Step 1: Write the migration**

```typescript
// apps/api/src/migrations/1752300000000-user-status.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserStatus1752300000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users ADD COLUMN status varchar(20) NOT NULL DEFAULT 'active'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE users DROP COLUMN status`);
  }
}
```

- [ ] **Step 2: Update the User entity**

Modify `apps/api/src/users/user.entity.ts`:

```typescript
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type Gender = 'female' | 'male';
export type UserRole = 'customer' | 'provider' | 'admin';
export type UserStatus = 'active' | 'suspended';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  phone: string;

  @Column({ type: 'varchar', nullable: true })
  name: string | null;

  @Column({ type: 'varchar', nullable: true })
  gender: Gender | null;

  @Column({ type: 'varchar', default: 'customer' })
  role: UserRole;

  @Column({ type: 'varchar', default: 'active' })
  status: UserStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
```

- [ ] **Step 3: Run the migration against the dev database**

Run: `pnpm --filter @gheychi/api migration:run`
Expected: `UserStatus1752300000000 has been executed successfully.`

- [ ] **Step 4: Write the failing e2e test**

```typescript
// apps/api/test/user-suspend-login.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import request from 'supertest';
import { Repository } from 'typeorm';
import { User } from '../src/users/user.entity';
import { loginAs } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Suspended users are blocked at login and mid-session (e2e)', () => {
  let app: INestApplication;
  let users: Repository<User>;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    users = app.get(getRepositoryToken(User));
  });

  afterAll(async () => {
    await app.close();
  });

  it('blocks verify-otp for an already-suspended user', async () => {
    const phone = '09122290001';
    await loginAs(app, phone); // creates the user
    await users.update({ phone }, { status: 'suspended' });

    await request(app.getHttpServer()).post('/api/auth/request-otp').send({ phone }).expect(201);
    // loginAs's own verify-otp call would normally succeed; here we expect it to fail,
    // so call the raw endpoints instead of reusing the loginAs() helper.
    const Redis = (await import('ioredis')).default;
    const redis = app.get<InstanceType<typeof Redis>>((await import('../src/redis/redis.module')).REDIS);
    const code = await redis.get(`otp:${phone}`);
    await request(app.getHttpServer())
      .post('/api/auth/verify-otp')
      .send({ phone, code })
      .expect(403);
  });

  it('immediately locks out a user suspended mid-session, despite a still-valid cookie', async () => {
    const phone = '09122290002';
    const cookie = await loginAs(app, phone);
    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(200);

    await users.update({ phone }, { status: 'suspended' });

    await request(app.getHttpServer()).get('/api/auth/me').set('Cookie', cookie).expect(403);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

Run: `pnpm --filter @gheychi/api test:e2e -- user-suspend-login`
Expected: FAIL -- both requests currently return 200/201 instead of 403 (no suspend check exists yet)

- [ ] **Step 6: Add the check to verify-otp**

Modify `apps/api/src/auth/auth.controller.ts`:

```typescript
import {
  Body, Controller, ForbiddenException, Get, HttpCode, Inject, Patch, Post, Req, Res, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request, Response } from 'express';
import { SMS_PROVIDER, SmsProvider } from '../sms/sms.provider';
import { User } from '../users/user.entity';
import { UsersService } from '../users/users.service';
import { AuthGuard, SESSION_COOKIE } from './auth.guard';
import { RequestOtpDto, UpdateProfileDto, VerifyOtpDto } from './dto/auth.dto';
import { OtpService } from './otp.service';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function publicUser(user: User) {
  const { id, phone, name, gender, role } = user;
  return { id, phone, name, gender, role };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  @Post('request-otp')
  async requestOtp(@Body() dto: RequestOtpDto) {
    const code = await this.otp.issue(dto.phone);
    await this.sms.sendOtp(dto.phone, code);
    return { ok: true };
  }

  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    const valid = await this.otp.verify(dto.phone, dto.code);
    if (!valid) throw new UnauthorizedException('Invalid or expired code');

    const { user, isNew } = await this.users.findOrCreateByPhone(dto.phone);
    if (user.status === 'suspended') throw new ForbiddenException('This account has been suspended');
    const token = await this.jwt.signAsync({ sub: user.id, role: user.role });
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: THIRTY_DAYS_MS,
    });
    return { user: publicUser(user), isNewUser: isNew };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: Request) {
    return publicUser(req.user as User);
  }

  @Patch('profile')
  @UseGuards(AuthGuard)
  async updateProfile(@Req() req: Request, @Body() dto: UpdateProfileDto) {
    const updated = await this.users.updateProfile((req.user as User).id, dto);
    return publicUser(updated);
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(SESSION_COOKIE);
  }
}
```

- [ ] **Step 7: Add the check to AuthGuard**

Modify `apps/api/src/auth/auth.guard.ts`:

```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';

export const SESSION_COOKIE = 'session';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync(token);
      const user = await this.users.findById(payload.sub);
      if (!user) throw new UnauthorizedException();
      if (user.status === 'suspended') throw new ForbiddenException('This account has been suspended');
      req.user = user;
      return true;
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      throw new UnauthorizedException();
    }
  }
}
```

(The `catch` block previously swallowed every error into a generic 401. `ForbiddenException` needs to pass through as a distinct 403 rather than being flattened into "invalid session" -- the two mean different things to the frontend: 401 means "log in again," 403-here means "you can't, period.")

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test:e2e -- user-suspend-login`
Expected: PASS (2 tests)

- [ ] **Step 9: Write a unit test for the AuthGuard's error-type distinction**

This is the one piece of new *logic* in this task (not just a status check, but the changed exception-handling branch), so it gets a real unit test. Create `apps/api/src/auth/auth.guard.spec.ts`:

```typescript
// apps/api/src/auth/auth.guard.spec.ts
import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './auth.guard';
import { UsersService } from '../users/users.service';

function mockContext(cookies: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ cookies }) }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  it('throws ForbiddenException (not UnauthorizedException) for a suspended user with an otherwise-valid token', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 'u1' }) } as unknown as JwtService;
    const users = {
      findById: jest.fn().mockResolvedValue({ id: 'u1', status: 'suspended' }),
    } as unknown as UsersService;
    const guard = new AuthGuard(jwt, users);

    await expect(guard.canActivate(mockContext({ session: 'valid-token' }))).rejects.toThrow(ForbiddenException);
  });

  it('still throws UnauthorizedException for a missing/invalid token', async () => {
    const jwt = { verifyAsync: jest.fn().mockRejectedValue(new Error('bad token')) } as unknown as JwtService;
    const users = {} as UsersService;
    const guard = new AuthGuard(jwt, users);

    await expect(guard.canActivate(mockContext({ session: 'garbage' }))).rejects.toThrow(UnauthorizedException);
  });
});
```

- [ ] **Step 10: Run it**

Run: `pnpm --filter @gheychi/api test -- auth.guard`
Expected: PASS (2 tests)

- [ ] **Step 11: Run the full backend suite to confirm no regressions**

Run: `pnpm --filter @gheychi/api test && pnpm --filter @gheychi/api test:e2e`
Expected: all suites pass

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/migrations/1752300000000-user-status.ts apps/api/src/users/user.entity.ts apps/api/src/auth/auth.controller.ts apps/api/src/auth/auth.guard.ts apps/api/src/auth/auth.guard.spec.ts apps/api/test/user-suspend-login.e2e-spec.ts
git commit -m "feat(api): block suspended users at login and mid-session

Two checkpoints: verify-otp rejects a suspended user with 403 before ever
issuing a session cookie, and AuthGuard rejects on every subsequent
request even with an otherwise-valid cookie (sessions last 30 days, so a
user suspended mid-session shouldn't stay logged in until it expires).
AuthGuard's catch block now re-throws ForbiddenException distinctly
instead of flattening every error into a generic 401 -- 401 means 'log in
again', this means 'you can't, period', and the frontend needs to tell
them apart."
```

---

## Task 19: Backend -- GET /admin/users and PATCH /admin/users/:id/status

**Files:**
- Create: `apps/api/src/users/admin-users.controller.ts`
- Create: `apps/api/src/users/dto/admin-user.dto.ts`
- Modify: `apps/api/src/users/users.module.ts`
- Create: `apps/api/test/admin-users.e2e-spec.ts`

`UsersModule` currently has no controller at all — this is the first one. Filters: `phone`/`name`/`role`/date-joined range (`joinedFrom`/`joinedTo`).

- [ ] **Step 1: Write the failing e2e test**

```typescript
// apps/api/test/admin-users.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin users list and suspend (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;
  let customerUserId: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122300001');
    await loginAs(app, '09122300002');

    const me = await request(app.getHttpServer())
      .get('/api/admin/users?phone=09122300002')
      .set('Cookie', adminCookie)
      .expect(200);
    customerUserId = me.body[0].id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('filters by phone', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/users?phone=09122300002')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].phone).toBe('09122300002');
  });

  it('filters by role', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/users?role=admin')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.some((u: { phone: string }) => u.phone === '09122300001')).toBe(true);
    expect(res.body.some((u: { phone: string }) => u.phone === '09122300002')).toBe(false);
  });

  it('suspends a user', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/users/${customerUserId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'suspended' })
      .expect(200);
    expect(res.body.status).toBe('suspended');
  });

  it('reactivates a suspended user', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/api/admin/users/${customerUserId}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'active' })
      .expect(200);
    expect(res.body.status).toBe('active');
  });

  it('404s an unknown user id', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/users/00000000-0000-0000-0000-000000000000/status')
      .set('Cookie', adminCookie)
      .send({ status: 'suspended' })
      .expect(404);
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122300099');
    await request(app.getHttpServer()).get('/api/admin/users').set('Cookie', customerCookie).expect(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-users`
Expected: FAIL with 404 (no route yet)

- [ ] **Step 3: Create the DTOs**

```typescript
// apps/api/src/users/dto/admin-user.dto.ts
import { IsIn, IsISO8601, IsOptional, IsString } from 'class-validator';

export class AdminUserQueryDto {
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['customer', 'provider', 'admin'])
  role?: 'customer' | 'provider' | 'admin';

  @IsOptional()
  @IsISO8601()
  joinedFrom?: string;

  @IsOptional()
  @IsISO8601()
  joinedTo?: string;
}

export class AdminUserStatusDto {
  @IsIn(['active', 'suspended'])
  status: 'active' | 'suspended';
}
```

- [ ] **Step 4: Create the admin controller**

```typescript
// apps/api/src/users/admin-users.controller.ts
import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Body, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AdminUserQueryDto, AdminUserStatusDto } from './dto/admin-user.dto';
import { User } from './user.entity';

@Controller('admin/users')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminUsersController {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  @Get()
  list(@Query() query: AdminUserQueryDto) {
    const qb = this.users
      .createQueryBuilder('user')
      .select(['user.id', 'user.phone', 'user.name', 'user.role', 'user.status', 'user.createdAt'])
      .orderBy('user.createdAt', 'DESC');

    if (query.phone) qb.andWhere('user.phone ILIKE :phone', { phone: `%${query.phone}%` });
    if (query.name) qb.andWhere('user.name ILIKE :name', { name: `%${query.name}%` });
    if (query.role) qb.andWhere('user.role = :role', { role: query.role });
    if (query.joinedFrom) qb.andWhere('user.createdAt >= :joinedFrom', { joinedFrom: query.joinedFrom });
    if (query.joinedTo) qb.andWhere('user.createdAt <= :joinedTo', { joinedTo: query.joinedTo });

    return qb.getMany();
  }

  @Patch(':id/status')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminUserStatusDto) {
    const result = await this.users.update({ id }, { status: dto.status });
    if (!result.affected) throw new NotFoundException();
    const { id: userId, phone, name, role, status, createdAt } = (await this.users.findOneBy({ id }))!;
    return { id: userId, phone, name, role, status, createdAt };
  }
}
```

- [ ] **Step 5: Register the controller**

Modify `apps/api/src/users/users.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminUsersController } from './admin-users.controller';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [AdminUsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

**Wait — check for a circular import before running anything.** `AuthModule` already imports `UsersModule` (see `apps/api/src/auth/auth.module.ts`, `imports: [UsersModule, ...]`). Adding `AuthModule` to `UsersModule`'s own imports here would create `UsersModule → AuthModule → UsersModule`, which NestJS's DI container cannot resolve and will throw a circular-dependency error at boot. Do **not** import `AuthModule` into `UsersModule`. Instead, `AdminUsersController` needs `AuthGuard`/`RolesGuard` some other way — `AuthModule` already exports both directly (not just via re-exporting `UsersModule`), so importing `AuthModule` from `UsersModule` is exactly backwards. The actual fix: register `AdminUsersController` in `AuthModule` instead (which already imports `UsersModule` and therefore already has `User`'s repository available transitively through `UsersModule`'s own `exports: [UsersService]` — but a raw `@InjectRepository(User)` needs `TypeOrmModule.forFeature([User])` in scope, which `UsersModule` provides and exports implicitly through Nest's module system only if `UsersModule` itself exports `TypeOrmModule`, which it currently does not).

Given that, the correct, non-circular wiring is:

```typescript
// apps/api/src/users/users.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
```

(Only the `exports` array changed — added `TypeOrmModule` alongside the existing `UsersService`, so any module that imports `UsersModule` also gets `@InjectRepository(User)` availability, matching the exact pattern `SalonsModule` already uses for `Salon`/`SalonService`/etc via its own `exports: [SalonsService, SalonOwnerGuard, TypeOrmModule]`.)

```typescript
// apps/api/src/auth/auth.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { SmsModule } from '../sms/sms.module';
import { UsersModule } from '../users/users.module';
import { AdminUsersController } from '../users/admin-users.controller';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { OtpService } from './otp.service';
import { RolesGuard } from './roles.guard';

@Module({
  imports: [
    UsersModule,
    SmsModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: '30d' },
      }),
    }),
  ],
  controllers: [AuthController, AdminUsersController],
  providers: [OtpService, AuthGuard, RolesGuard],
  exports: [OtpService, AuthGuard, RolesGuard, UsersModule],
})
export class AuthModule {}
```

(`AdminUsersController` is registered as a controller of `AuthModule`, not `UsersModule` -- this mirrors the exact reasoning `SalonsModule` uses for its own admin controller: `AdminSalonsController` lives in `SalonsModule`, not `AuthModule`, specifically because `SalonsModule` already imports `AuthModule` with no cycle risk the other direction. Here the dependency direction is inverted -- `AuthModule` already depends on `UsersModule`, so the admin-users controller has to live on the side of that relationship that already has both guards AND the repository in scope without creating a cycle, which is `AuthModule`.)

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-users`
Expected: PASS (6 tests)

- [ ] **Step 7: Run the full backend suite to confirm no regressions and no circular-dependency boot error**

Run: `pnpm --filter @gheychi/api test:e2e`
Expected: all suites pass, app boots cleanly (a circular DI error would surface here as every single e2e suite failing at `createTestApp()`, not just this new one — if that happens, re-check the imports/exports above rather than assuming a code typo)

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/users/admin-users.controller.ts apps/api/src/users/dto/admin-user.dto.ts apps/api/src/users/users.module.ts apps/api/src/auth/auth.module.ts apps/api/test/admin-users.e2e-spec.ts
git commit -m "feat(api): GET /admin/users and PATCH /admin/users/:id/status

First controller UsersModule has ever had. Registered on AuthModule
instead (which already depends on UsersModule one-way) to avoid a
UsersModule<->AuthModule circular import -- UsersModule now exports
TypeOrmModule too, the same pattern SalonsModule already uses, so
AdminUsersController gets @InjectRepository(User) without UsersModule
needing to import AuthModule back."
```

---

## Task 20: Frontend (admin) -- users view with suspend/unsuspend

**Files:**
- Create: `apps/admin-panel/src/components/users/SuspendUserButton.vue`
- Create: `apps/admin-panel/src/components/users/SuspendUserButton.spec.ts`
- Create: `apps/admin-panel/src/pages/UsersView.vue`
- Modify: `apps/admin-panel/src/router/index.ts`

Same split as Slices 1-2: `SuspendUserButton.vue` is logic-bearing and gets a test; `UsersView.vue` is a plain filterable list and doesn't.

- [ ] **Step 1: Write the failing test for SuspendUserButton**

```typescript
// apps/admin-panel/src/components/users/SuspendUserButton.spec.ts
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SuspendUserButton from './SuspendUserButton.vue'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('SuspendUserButton', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('shows a suspend action for an active user and calls the status endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'suspended' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'active' } })

    expect(wrapper.find('[data-testid="suspend-user"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="unsuspend-user"]').exists()).toBe(false)

    await wrapper.get('[data-testid="suspend-user"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/users/u1/status', { method: 'PATCH', body: { status: 'suspended' } })
    expect(wrapper.emitted('updated')?.[0]).toEqual([{ id: 'u1', status: 'suspended' }])
  })

  it('shows an unsuspend action for a suspended user and calls the status endpoint', async () => {
    fetchMock.mockResolvedValueOnce({ data: { id: 'u1', status: 'active' }, error: null })
    const wrapper = mount(SuspendUserButton, { props: { userId: 'u1', status: 'suspended' } })

    expect(wrapper.find('[data-testid="unsuspend-user"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="suspend-user"]').exists()).toBe(false)

    await wrapper.get('[data-testid="unsuspend-user"]').trigger('click')

    expect(fetchMock).toHaveBeenCalledWith('/admin/users/u1/status', { method: 'PATCH', body: { status: 'active' } })
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/admin-panel test -- --run SuspendUserButton`
Expected: FAIL with "Cannot find module './SuspendUserButton.vue'"

- [ ] **Step 3: Create SuspendUserButton.vue**

```vue
<!-- apps/admin-panel/src/components/users/SuspendUserButton.vue -->
<script setup lang="ts">
import { useApi } from '@/composables/useApi'

const props = defineProps<{ userId: string; status: 'active' | 'suspended' }>()
const emit = defineEmits<{ updated: [user: { id: string; status: string }] }>()

const { apiFetch } = useApi()

async function toggle() {
  const target = props.status === 'active' ? 'suspended' : 'active'
  const { data } = await apiFetch<{ id: string; status: string }>(`/admin/users/${props.userId}/status`, {
    method: 'PATCH',
    body: { status: target },
  })
  if (data) emit('updated', data)
}
</script>

<template>
  <button
    v-if="status === 'active'"
    data-testid="suspend-user"
    type="button"
    class="rounded-lg border border-red-600 px-3 py-1 text-sm text-red-600"
    @click="toggle"
  >
    تعلیق
  </button>
  <button
    v-else
    data-testid="unsuspend-user"
    type="button"
    class="rounded-lg bg-(--color-accent) px-3 py-1 text-sm text-white"
    @click="toggle"
  >
    رفع تعلیق
  </button>
</template>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gheychi/admin-panel test -- --run SuspendUserButton`
Expected: PASS (2 tests)

- [ ] **Step 5: Create UsersView.vue**

```vue
<!-- apps/admin-panel/src/pages/UsersView.vue -->
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'
import SuspendUserButton from '@/components/users/SuspendUserButton.vue'

interface UserRow {
  id: string
  phone: string
  name: string | null
  role: 'customer' | 'provider' | 'admin'
  status: 'active' | 'suspended'
  createdAt: string
}

const { apiFetch } = useApi()
const users = ref<UserRow[]>([])
const loading = ref(true)

const phoneFilter = ref('')
const nameFilter = ref('')
const roleFilter = ref<'' | 'customer' | 'provider' | 'admin'>('')
const joinedFrom = ref('')
const joinedTo = ref('')

async function load() {
  loading.value = true
  const params = new URLSearchParams()
  if (phoneFilter.value) params.set('phone', phoneFilter.value)
  if (nameFilter.value) params.set('name', nameFilter.value)
  if (roleFilter.value) params.set('role', roleFilter.value)
  if (joinedFrom.value) params.set('joinedFrom', new Date(joinedFrom.value).toISOString())
  if (joinedTo.value) params.set('joinedTo', new Date(joinedTo.value).toISOString())

  const { data } = await apiFetch<UserRow[]>(`/admin/users?${params.toString()}`, { silent: true })
  users.value = data ?? []
  loading.value = false
}

function onUpdated(userId: string, status: string) {
  const user = users.value.find((u) => u.id === userId)
  if (user) user.status = status as UserRow['status']
}

onMounted(load)
watch([phoneFilter, nameFilter, roleFilter, joinedFrom, joinedTo], load)
</script>

<template>
  <div class="space-y-4 p-6">
    <h1 class="text-lg font-bold">کاربران</h1>

    <div class="flex flex-wrap gap-3">
      <input v-model="phoneFilter" placeholder="شماره موبایل" class="rounded-lg border p-2 text-sm" />
      <input v-model="nameFilter" placeholder="نام" class="rounded-lg border p-2 text-sm" />
      <select v-model="roleFilter" class="rounded-lg border p-2 text-sm">
        <option value="">همه نقش‌ها</option>
        <option value="customer">مشتری</option>
        <option value="provider">آرایشگاه‌دار</option>
        <option value="admin">مدیر</option>
      </select>
      <input v-model="joinedFrom" type="date" class="rounded-lg border p-2 text-sm" />
      <input v-model="joinedTo" type="date" class="rounded-lg border p-2 text-sm" />
    </div>

    <p v-if="!loading && users.length === 0" class="text-sm text-gray-500">موردی یافت نشد.</p>

    <table v-else class="w-full text-right text-sm">
      <thead>
        <tr class="border-b text-gray-500">
          <th class="p-2">نام</th>
          <th class="p-2">موبایل</th>
          <th class="p-2">نقش</th>
          <th class="p-2">وضعیت</th>
          <th class="p-2"></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="user in users" :key="user.id" class="border-b">
          <td class="p-2">{{ user.name ?? '—' }}</td>
          <td class="p-2">{{ user.phone }}</td>
          <td class="p-2">{{ user.role }}</td>
          <td class="p-2">{{ user.status }}</td>
          <td class="p-2">
            <SuspendUserButton :user-id="user.id" :status="user.status" @updated="(u) => onUpdated(u.id, u.status)" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 6: Register the route**

Modify `apps/admin-panel/src/router/index.ts`:

```typescript
      { path: 'users', name: 'users', component: () => import('@/pages/UsersView.vue') },
```

- [ ] **Step 7: Run the full suite and typecheck**

Run: `pnpm --filter @gheychi/admin-panel test -- --run`
Expected: 8 files, 27 tests passed

Run: `pnpm --filter @gheychi/admin-panel typecheck`
Expected: no errors

- [ ] **Step 8: Commit**

```bash
git add apps/admin-panel/src/components/users apps/admin-panel/src/pages/UsersView.vue apps/admin-panel/src/router/index.ts
git commit -m "feat(admin-panel): add the users view with suspend/unsuspend

SuspendUserButton.vue toggles active<->suspended and gets a real test;
UsersView.vue is a plain filterable list and doesn't, same split as
every other slice's admin view."
```

---

## Task 21: Frontend (admin) -- expose the full salon filter set

**Files:**
- Modify: `apps/api/src/salons/dto/admin-salon-query.dto.ts`
- Modify: `apps/api/src/salons/admin-salons.controller.ts`
- Modify: `apps/api/test/admin-salons-list.e2e-spec.ts`
- Modify: `apps/admin-panel/src/pages/SalonsView.vue`

Closes Slice 4. Task 6's backend already accepts `status`/`city`/`name`/`genderTarget`, but `status` only ever has two effective modes: an explicit value, or absent-and-thus-defaulted-to-`pending`. There is no way to explicitly ask for every status at once, which the salon *search* use case (as opposed to the approval-*queue* use case) needs. This task adds a real `'all'` value on the backend (not an empty string, which would 400 against the existing `@IsIn` validator) and wires a checkbox to it on the frontend.

- [ ] **Step 1: Add the `all` status option to the query DTO**

Modify `apps/api/src/salons/dto/admin-salon-query.dto.ts`:

```typescript
import { IsIn, IsOptional, IsString } from 'class-validator';

export class AdminSalonQueryDto {
  @IsOptional()
  @IsIn(['all', 'pending', 'approved', 'rejected', 'suspended'])
  status?: 'all' | 'pending' | 'approved' | 'rejected' | 'suspended';

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(['women', 'men'])
  genderTarget?: 'women' | 'men';
}
```

- [ ] **Step 2: Skip the status filter when `all` is requested**

Modify `apps/api/src/salons/admin-salons.controller.ts`'s `list()` method:

```typescript
  @Get()
  list(@Query() query: AdminSalonQueryDto) {
    const qb = this.salons
      .createQueryBuilder('salon')
      .select(['salon.id', 'salon.name', 'salon.city', 'salon.status', 'salon.genderTarget', 'salon.isFeatured', 'salon.featuredUntil', 'salon.createdAt'])
      .orderBy('salon.name', 'ASC');

    const status = query.status ?? 'pending';
    if (status !== 'all') qb.andWhere('salon.status = :status', { status });

    if (query.city) qb.andWhere('salon.city ILIKE :city', { city: `%${query.city}%` });
    if (query.name) qb.andWhere('salon.name ILIKE :name', { name: `%${query.name}%` });
    if (query.genderTarget) qb.andWhere('salon.genderTarget = :genderTarget', { genderTarget: query.genderTarget });

    return qb.getMany();
  }
```

(Switched from `.where()` to `.andWhere()` for the status clause since it's now conditional -- with no other `.where()` call preceding it, TypeORM's query builder treats a leading `.andWhere()` the same as `.where()` when the query has no prior conditions, so this is safe.)

- [ ] **Step 3: Extend the e2e test for the new `all` value**

Modify `apps/api/test/admin-salons-list.e2e-spec.ts` — add one more test case:

```typescript
  it('status=all returns every status with no filtering', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/admin/salons?status=all')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2); // at least the 2 pending salons seeded in beforeAll
  });
```

- [ ] **Step 4: Run the backend test to verify it passes**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-salons-list`
Expected: PASS (7 tests)

- [ ] **Step 5: Add a "show all statuses" checkbox to the frontend**

Modify `apps/admin-panel/src/pages/SalonsView.vue` — add a `showAllStatuses` ref, use it in `load()`, and add the checkbox to the template:

```vue
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'

interface SalonRow {
  id: string
  name: string
  city: string
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  genderTarget: 'women' | 'men'
  isFeatured: boolean
  createdAt: string
}

const { apiFetch } = useApi()
const salons = ref<SalonRow[]>([])
const loading = ref(true)

const statusFilter = ref<'pending' | 'approved' | 'rejected' | 'suspended'>('pending')
const showAllStatuses = ref(false)
const cityFilter = ref('')
const nameFilter = ref('')
const genderFilter = ref<'' | 'women' | 'men'>('')

async function load() {
  loading.value = true
  const params = new URLSearchParams({ status: showAllStatuses.value ? 'all' : statusFilter.value })
  if (cityFilter.value) params.set('city', cityFilter.value)
  if (nameFilter.value) params.set('name', nameFilter.value)
  if (genderFilter.value) params.set('genderTarget', genderFilter.value)

  const { data } = await apiFetch<SalonRow[]>(`/admin/salons?${params.toString()}`, { silent: true })
  salons.value = data ?? []
  loading.value = false
}

onMounted(load)
watch([statusFilter, showAllStatuses, cityFilter, nameFilter, genderFilter], load)
</script>

<template>
  <div class="space-y-4 p-6">
    <h1 class="text-lg font-bold">آرایشگاه‌ها</h1>

    <div class="flex flex-wrap items-center gap-3">
      <label class="flex items-center gap-1 text-sm">
        <input v-model="showAllStatuses" type="checkbox" data-testid="show-all-statuses" />
        همه وضعیت‌ها
      </label>
      <select v-model="statusFilter" data-testid="status-filter" :disabled="showAllStatuses" class="rounded-lg border p-2 text-sm">
        <option value="pending">در انتظار بررسی</option>
        <option value="approved">تایید شده</option>
        <option value="rejected">رد شده</option>
        <option value="suspended">معلق</option>
      </select>
      <input v-model="cityFilter" placeholder="شهر" class="rounded-lg border p-2 text-sm" />
      <input v-model="nameFilter" placeholder="نام آرایشگاه" class="rounded-lg border p-2 text-sm" />
      <select v-model="genderFilter" class="rounded-lg border p-2 text-sm">
        <option value="">همه</option>
        <option value="women">بانوان</option>
        <option value="men">آقایان</option>
      </select>
    </div>

    <p v-if="!loading && salons.length === 0" class="text-sm text-gray-500">موردی یافت نشد.</p>

    <table v-else class="w-full text-right text-sm">
      <thead>
        <tr class="border-b text-gray-500">
          <th class="p-2">نام</th>
          <th class="p-2">شهر</th>
          <th class="p-2">مخاطب</th>
          <th class="p-2">وضعیت</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="salon in salons" :key="salon.id" class="border-b">
          <td class="p-2">
            <RouterLink :to="`/salons/${salon.id}`" class="text-(--color-accent)">{{ salon.name }}</RouterLink>
          </td>
          <td class="p-2">{{ salon.city }}</td>
          <td class="p-2">{{ salon.genderTarget === 'women' ? 'بانوان' : 'آقایان' }}</td>
          <td class="p-2">{{ salon.status }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
```

- [ ] **Step 6: Run the full backend and frontend suites, and typecheck both**

Run: `pnpm --filter @gheychi/api test:e2e`
Expected: all suites pass

Run: `pnpm --filter @gheychi/admin-panel test -- --run && pnpm --filter @gheychi/admin-panel typecheck`
Expected: 8 files, 27 tests passed; no typecheck errors (this task adds no new admin-panel test file -- `SalonsView.vue` stays a plain untested list view)

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/salons/dto/admin-salon-query.dto.ts apps/api/src/salons/admin-salons.controller.ts apps/api/test/admin-salons-list.e2e-spec.ts apps/admin-panel/src/pages/SalonsView.vue
git commit -m "feat(admin): add an explicit status=all option to salon search

Task 6's list() only ever defaulted an absent status to 'pending' -- there
was no way to actually ask for every status at once, which the salon
search use case (as opposed to the approval-queue use case) needs. Adds
'all' as a real accepted value rather than overloading an empty string,
which would have 400'd against the existing @IsIn validator. Closes
Slice 4."
```

---

## Task 22: Backend -- GET/PATCH /admin/config

**Files:**
- Modify: `apps/api/src/platform-config/platform-config.service.ts`
- Modify: `apps/api/src/platform-config/platform-config.service.spec.ts` (create if it doesn't exist yet)
- Create: `apps/api/src/platform-config/admin-config.controller.ts`
- Create: `apps/api/src/platform-config/dto/admin-config.dto.ts`
- Modify: `apps/api/src/platform-config/platform-config.module.ts`
- Create: `apps/api/test/admin-config.e2e-spec.ts`

Slice 5 starts here — the last slice. `PlatformConfigService` currently only has getters; this adds a `set()` method and the two admin endpoints. Generic key/value, all numeric, per the design doc — no per-key curation.

- [ ] **Step 1: Write the failing unit test for PlatformConfigService.set()**

Create `apps/api/src/platform-config/platform-config.service.spec.ts` (this service has no existing unit test file — its getters are already covered indirectly by other modules' e2e tests, but `set()` is new logic that deserves a direct test):

```typescript
// apps/api/src/platform-config/platform-config.service.spec.ts
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { PlatformConfig } from './platform-config.entity';
import { PlatformConfigService } from './platform-config.service';

describe('PlatformConfigService.set', () => {
  let service: PlatformConfigService;
  let repo: { upsert: jest.Mock };

  beforeEach(async () => {
    repo = { upsert: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [PlatformConfigService, { provide: getRepositoryToken(PlatformConfig), useValue: repo }],
    }).compile();
    service = moduleRef.get(PlatformConfigService);
  });

  it('upserts the given key/value pair', async () => {
    await service.set('commission_percent', 12);
    expect(repo.upsert).toHaveBeenCalledWith({ key: 'commission_percent', value: 12 }, ['key']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @gheychi/api test -- platform-config.service`
Expected: FAIL -- `service.set` is not a function

- [ ] **Step 3: Add PlatformConfigService.set() and a listAll() getter**

Modify `apps/api/src/platform-config/platform-config.service.ts` — read the existing file first to see its exact current getters (`getDepositPercent`, `getDepositMinToman`, `getCancellationWindowHours`, `getCommissionPercent`, `getBookingHoldTtlMinutes`, `getReminderLeadHours`) and add these two methods without disturbing them:

```typescript
  listAll(): Promise<PlatformConfig[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  async set(key: string, value: unknown): Promise<void> {
    await this.repo.upsert({ key, value }, ['key']);
  }
```

(`this.repo` is the existing injected `Repository<PlatformConfig>` this service's other getters already use -- match whatever the constructor-injected field is actually named in the current file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test -- platform-config.service`
Expected: PASS (1 test)

- [ ] **Step 5: Write the failing e2e test for the admin config endpoints**

```typescript
// apps/api/test/admin-config.e2e-spec.ts
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loginAs, loginAsAdmin } from './utils/auth-helper';
import { resetDatabase } from './utils/db';
import { createTestApp } from './utils/test-app';

describe('Admin platform config (e2e)', () => {
  let app: INestApplication;
  let adminCookie: string;

  beforeAll(async () => {
    await resetDatabase();
    app = await createTestApp();
    adminCookie = await loginAsAdmin(app, '09122310001');
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists every seeded config key', async () => {
    const res = await request(app.getHttpServer()).get('/api/admin/config').set('Cookie', adminCookie).expect(200);
    const keys = res.body.map((row: { key: string }) => row.key).sort();
    expect(keys).toEqual([
      'booking_hold_ttl_minutes',
      'cancellation_window_hours',
      'commission_percent',
      'deposit_min_toman',
      'deposit_percent',
      'reminder_lead_hours',
    ]);
  });

  it('bulk-updates several keys and reflects the change in a follow-up read', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/config')
      .set('Cookie', adminCookie)
      .send({ updates: [{ key: 'commission_percent', value: 12 }, { key: 'deposit_percent', value: 25 }] })
      .expect(200);

    const res = await request(app.getHttpServer()).get('/api/admin/config').set('Cookie', adminCookie).expect(200);
    const byKey = Object.fromEntries(res.body.map((r: { key: string; value: unknown }) => [r.key, r.value]));
    expect(byKey.commission_percent).toBe(12);
    expect(byKey.deposit_percent).toBe(25);
  });

  it('rejects a non-numeric value', async () => {
    await request(app.getHttpServer())
      .patch('/api/admin/config')
      .set('Cookie', adminCookie)
      .send({ updates: [{ key: 'commission_percent', value: 'not a number' }] })
      .expect(400);
  });

  it('rejects a non-admin caller', async () => {
    const customerCookie = await loginAs(app, '09122310099');
    await request(app.getHttpServer()).get('/api/admin/config').set('Cookie', customerCookie).expect(403);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-config`
Expected: FAIL with 404 (no routes yet)

- [ ] **Step 7: Create the update DTO**

```typescript
// apps/api/src/platform-config/dto/admin-config.dto.ts
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsString, ValidateNested } from 'class-validator';

class ConfigUpdateEntryDto {
  @IsString()
  key: string;

  @IsNumber()
  value: number;
}

export class UpdateConfigDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConfigUpdateEntryDto)
  updates: ConfigUpdateEntryDto[];
}
```

- [ ] **Step 8: Create the admin controller**

```typescript
// apps/api/src/platform-config/admin-config.controller.ts
import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { UpdateConfigDto } from './dto/admin-config.dto';
import { PlatformConfigService } from './platform-config.service';

@Controller('admin/config')
@UseGuards(AuthGuard, RolesGuard)
@Roles('admin')
export class AdminConfigController {
  constructor(private readonly config: PlatformConfigService) {}

  @Get()
  list() {
    return this.config.listAll();
  }

  @Patch()
  async update(@Body() dto: UpdateConfigDto) {
    for (const entry of dto.updates) {
      await this.config.set(entry.key, entry.value);
    }
    return this.config.listAll();
  }
}
```

- [ ] **Step 9: Register the controller**

Modify `apps/api/src/platform-config/platform-config.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AdminConfigController } from './admin-config.controller';
import { PlatformConfig } from './platform-config.entity';
import { PlatformConfigController } from './platform-config.controller';
import { PlatformConfigService } from './platform-config.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlatformConfig]), AuthModule],
  controllers: [PlatformConfigController, AdminConfigController],
  providers: [PlatformConfigService],
  exports: [PlatformConfigService],
})
export class PlatformConfigModule {}
```

(No circular-dependency risk here, unlike Task 19's `UsersModule` -- `AuthModule` does not depend on `PlatformConfigModule`, so `PlatformConfigModule → AuthModule` is a one-way edge.)

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm --filter @gheychi/api test:e2e -- admin-config`
Expected: PASS (4 tests)

- [ ] **Step 11: Run the full backend suite to confirm no regressions**

Run: `pnpm --filter @gheychi/api test && pnpm --filter @gheychi/api test:e2e`
Expected: all suites pass

- [ ] **Step 12: Commit**

```bash
git add apps/api/src/platform-config apps/api/test/admin-config.e2e-spec.ts
git commit -m "feat(api): GET/PATCH /admin/config -- generic key/value editing

PlatformConfigService gains set()/listAll() alongside its existing typed
getters (which are untouched). The update endpoint is a bulk upsert over
whatever keys are sent -- no per-key curation, new platform_config keys
added elsewhere in the codebase show up automatically without this
endpoint needing a matching change, per the design doc."
```

---

## Task 23: Frontend (admin) -- config editor view

**Files:**
- Create: `apps/admin-panel/src/pages/ConfigView.vue`
- Modify: `apps/admin-panel/src/router/index.ts`

Closes Slice 5. A single plain view — no unit test, matching the design doc's testing scope exactly ("the config editor stays untested").

- [ ] **Step 1: Create ConfigView.vue**

```vue
<!-- apps/admin-panel/src/pages/ConfigView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'

interface ConfigRow {
  key: string
  value: number
}

const { apiFetch } = useApi()
const rows = ref<ConfigRow[]>([])
const saving = ref(false)

async function load() {
  const { data } = await apiFetch<ConfigRow[]>('/admin/config', { silent: true })
  rows.value = data ?? []
}

async function save() {
  saving.value = true
  await apiFetch('/admin/config', {
    method: 'PATCH',
    body: { updates: rows.value.map((r) => ({ key: r.key, value: r.value })) },
  })
  saving.value = false
}

onMounted(load)
</script>

<template>
  <div class="max-w-md space-y-4 p-6">
    <h1 class="text-lg font-bold">تنظیمات پلتفرم</h1>

    <div v-for="row in rows" :key="row.key" class="flex items-center justify-between gap-3">
      <label class="text-sm">{{ row.key }}</label>
      <input v-model.number="row.value" type="number" class="w-32 rounded-lg border p-2 text-sm" />
    </div>

    <button
      type="button"
      :disabled="saving"
      class="rounded-lg bg-(--color-accent) px-4 py-2 text-sm text-white"
      @click="save"
    >
      ذخیره
    </button>
  </div>
</template>
```

- [ ] **Step 2: Register the route**

Modify `apps/admin-panel/src/router/index.ts`:

```typescript
      { path: 'config', name: 'config', component: () => import('@/pages/ConfigView.vue') },
```

- [ ] **Step 3: Run the suite and typecheck**

Run: `pnpm --filter @gheychi/admin-panel test -- --run`
Expected: 8 files, 27 tests passed (unchanged -- no test file added)

Run: `pnpm --filter @gheychi/admin-panel typecheck`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/admin-panel/src/pages/ConfigView.vue apps/admin-panel/src/router/index.ts
git commit -m "feat(admin-panel): add the platform config editor

Generic key/value list, all numeric inputs, bulk save. Plain view, no
unit test, matching the design doc's testing scope exactly. Closes
Slice 5 -- every area from the original design doc is now built."
```

---

## Task 24: E2E infrastructure and the salon-approval happy path

**Files:**
- Create: `apps/admin-panel/playwright.config.ts`
- Create: `apps/admin-panel/e2e/global-setup.ts`
- Create: `apps/admin-panel/e2e/package.json`
- Create: `apps/admin-panel/e2e/01-approve-salon.spec.ts`
- Modify: `apps/admin-panel/package.json`

Mirrors Provider Panel's Playwright setup (Plan 5, Task 25) exactly: schema reset, migration run, Redis flush, then a raw-SQL seed. Port `3005` instead of `3004`. Seeds an admin account and a separate provider account with a `pending` salon, so the one e2e test can log in as the admin and approve it.

- [ ] **Step 1: Add pg/@types/pg/ioredis as dev dependencies**

Modify `apps/admin-panel/package.json` — add to `devDependencies` (matching exactly what Provider Panel's Task 25 needed, for the same reason: `global-setup.ts` needs direct Postgres/Redis access, separate from the app's own runtime code which never touches either directly):

```json
    "ioredis": "^5.6.0",
    "pg": "^8.13.0",
```

And to a new `@types/pg` entry alongside the existing `@types/node`:

```json
    "@types/pg": "^8.20.0",
```

Run: `pnpm install`
Expected: installs cleanly

- [ ] **Step 2: Create playwright.config.ts**

```typescript
// apps/admin-panel/playwright.config.ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  use: { baseURL: 'http://localhost:3005' },
  webServer: [
    {
      command: 'pnpm --filter @gheychi/api dev',
      url: 'http://localhost:3002/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'pnpm --filter @gheychi/admin-panel dev',
      url: 'http://localhost:3005',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
```

- [ ] **Step 3: Create e2e/package.json**

```json
{
  "type": "commonjs"
}
```

(Without this, `global-setup.ts`'s use of `__dirname` throws under the parent `apps/admin-panel/package.json`'s `"type": "module"`, since Playwright transpiles `e2e/*.ts` in an ESM context otherwise -- the exact issue Provider Panel's Task 25 hit and fixed the same way.)

- [ ] **Step 4: Create global-setup.ts**

```typescript
// apps/admin-panel/e2e/global-setup.ts
import { Client } from 'pg'
import { execSync } from 'node:child_process'
import path from 'node:path'
import Redis from 'ioredis'

function makeClient() {
  return new Client({
    host: process.env.DB_HOST ?? 'localhost',
    port: Number(process.env.DB_PORT ?? 5544),
    user: process.env.DB_USER ?? 'gheychi',
    password: process.env.DB_PASS ?? 'gheychi',
    database: process.env.DB_NAME ?? 'gheychi',
  })
}

export default async function globalSetup() {
  const client = makeClient()
  await client.connect()
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await client.end()

  // Same reasoning as provider-panel's global-setup.ts: OtpService rate-limits requests
  // per phone via a Redis key that outlives a Postgres reset, so flush both.
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })
  await redis.flushdb()
  await redis.quit()

  execSync('pnpm --filter @gheychi/api migration:run', {
    cwd: path.resolve(__dirname, '../../..'),
    stdio: 'inherit',
  })

  const seed = makeClient()
  await seed.connect()
  await seed.query(`INSERT INTO users (phone, role) VALUES ('09120000500', 'admin')`)
  const { rows: [{ id: ownerId }] } = await seed.query(
    `INSERT INTO users (phone, role) VALUES ('09120000501', 'provider') RETURNING id`,
  )
  await seed.query(
    `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location)
     VALUES ($1, 'سالن در انتظار تایید', 'e2e-admin-panel-salon', 'women', 'pending', 'آدرس تست', 'تهران',
       ST_SetSRID(ST_MakePoint(51.389, 35.6892), 4326)::geography)`,
    [ownerId],
  )
  await seed.end()
}
```

- [ ] **Step 5: Write the failing e2e test**

```typescript
// apps/admin-panel/e2e/01-approve-salon.spec.ts
import { test, expect } from '@playwright/test'
import Redis from 'ioredis'

test('log in as admin, approve a pending salon', async ({ page, request }) => {
  const phone = '09120000500'
  const redis = new Redis({ host: process.env.REDIS_HOST ?? 'localhost', port: Number(process.env.REDIS_PORT ?? 6381) })

  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.getByTestId('phone-input').fill(phone)
  await page.getByTestId('phone-form').getByRole('button').click()

  const codeInput = page.getByTestId('code-input')
  await expect(codeInput).toBeVisible()
  const code = await redis.get(`otp:${phone}`)
  await redis.quit()
  if (!code) throw new Error('OTP was not found in Redis -- did SMS_PROVIDER/OtpService change?')
  await codeInput.fill(code)
  await page.getByTestId('code-form').getByRole('button').click()

  await expect(page).toHaveURL('/')

  await page.getByRole('link', { name: 'آرایشگاه‌ها' }).click()
  await expect(page).toHaveURL('/salons')

  await page.getByRole('link', { name: 'سالن در انتظار تایید' }).click()
  await expect(page).toHaveURL(/\/salons\/[0-9a-f-]+/)
  const salonId = page.url().split('/salons/')[1]

  await page.getByTestId('approve-button').click()

  // Verify the status genuinely flipped via a follow-up API call, not just a UI assertion --
  // the page's own text would say "approved" either way if the click handler were a no-op
  // that just optimistically rendered without checking the API's response.
  const cookies = await page.context().cookies()
  const sessionCookie = cookies.map((c) => `${c.name}=${c.value}`).join('; ')
  await expect
    .poll(async () => {
      const res = await request.get(`http://localhost:3002/api/admin/salons/${salonId}`, {
        headers: { Cookie: sessionCookie },
      })
      return (await res.json()).status
    })
    .toBe('approved')
})
```

- [ ] **Step 6: Run it**

Run: `pnpm --filter @gheychi/admin-panel test:e2e`
Expected: PASS (1 test) -- if the OS-level Chromium dependencies (`libnspr4`, etc.) aren't already installed in this environment, install them first (`sudo npx playwright install-deps` or the `wsl -u root -- npx playwright install-deps` workaround used for Provider Panel's Task 25, if a sudo password prompt hangs); the browser binary itself may already be shared from Provider Panel's earlier setup (`~/.cache/ms-playwright/`) and not need reinstalling

- [ ] **Step 7: Run the full admin-panel suite one more time**

Run: `pnpm --filter @gheychi/admin-panel test -- --run && pnpm --filter @gheychi/admin-panel typecheck`
Expected: 8 files, 27 tests passed; no typecheck errors

- [ ] **Step 8: Commit**

```bash
git add apps/admin-panel/playwright.config.ts apps/admin-panel/e2e apps/admin-panel/package.json pnpm-lock.yaml
git commit -m "test(admin-panel): add Playwright e2e setup and the salon-approval happy path

Mirrors provider-panel's Playwright infra exactly (schema reset, Redis
flush, migration run, raw-SQL seed, e2e/package.json's type:commonjs fix
for __dirname under the parent's type:module). The one e2e test ties
together the actual loop this whole plan exists to close: admin logs in,
approves a pending salon, and the status change is verified via a
follow-up API call rather than trusting the UI's own rendering."
```

---

## Task 25: Final wiring and documentation

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

The root `dev:admin-panel` script was already added in Task 1; `pnpm-workspace.yaml`'s `apps/*` glob needed no change. This task is documentation-only, closing out two gaps: `README.md`'s "Structure" section still says `admin-panel` is a "future plan, not yet started" (now false), and separately still says the same about `provider-panel` (already false since Plan 5 shipped — apparently missed when Plan 5 wrapped up). `CLAUDE.md`'s "Known Gaps" section has the same staleness plus one more: it still lists "no salon photo upload path" as an open gap, which Plan 5 also already closed.

- [ ] **Step 1: Fix README.md's Structure section**

Modify `README.md` lines 9-10:

```markdown
- `apps/provider-panel` — Vue 3 SPA (Plan 5)
- `apps/admin-panel` — Vue 3 SPA (Plan 6)
```

- [ ] **Step 2: Retitle and extend the Plan 5 section**

Modify `README.md` — the existing `## Provider panel backend additions (Plan 5)` heading and its last bullet (lines 65-71):

```markdown
## Provider panel (Plan 5)

A Vue 3 + Vite SPA (`apps/provider-panel`) covering onboarding, dashboard, bookings, services, hours, photos, reviews, and earnings for salon owners. Backend additions it needed:

- `POST /api/salons/mine/photos` — upload a salon photo (multipart `file` field, jpeg/png/webp, 5MB max); the first photo uploaded is automatically marked cover. `PATCH /api/salons/mine/photos/:id` (isCover/sortOrder), `DELETE /api/salons/mine/photos/:id`.
- Photo storage goes through a swappable `StorageProvider` (`STORAGE_PROVIDER=local|s3`, same pattern as `SmsProvider`/`PaymentGateway`/`PushProvider`) — `local` writes under `apps/api/uploads/` and serves it at `/uploads/*`; `s3` talks to any S3-compatible bucket via `S3_ENDPOINT`/`S3_BUCKET`/`S3_REGION`/`S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`/`S3_PUBLIC_BASE_URL`.
- `GET /api/salons/mine/earnings` — `{ totalCollected, commissionPercent, commissionAmount, netPayout }`, computed from `paid` payments on the caller's own bookings. No new payment infrastructure; purely aggregates existing `Booking`/`Payment` rows.
- CORS now allows both `FRONTEND_BASE_URL` (user-app) and `PROVIDER_APP_BASE_URL` (provider-panel) as credentialed origins.
- No salon-approval workflow was added by this plan — that gap is closed by Plan 6 below.
```

- [ ] **Step 3: Add the Admin Panel section**

Modify `README.md` — add a new section after the "Provider panel (Plan 5)" section:

```markdown
## Admin panel (Plan 6)

A Vue 3 + Vite SPA (`apps/admin-panel`), desktop-oriented (sidebar nav, not the mobile bottom-nav pattern the other two frontends use), covering the five areas from the original design doc:

- **Salon approvals** — a filterable queue (`GET /api/admin/salons`, defaulting to `pending`), a detail view, and `PATCH /api/admin/salons/:id/status` (approve/reject/suspend, reason required for reject/suspend). Provider Panel gained a matching Settings page and `POST /api/salons/mine/resubmit` so a rejected provider has a real recovery path — `pending → approved` is no longer a manual DB update anywhere in the system.
- **Review moderation** — `GET /api/admin/reviews` (filterable by salon/status/rating), on top of the moderation endpoint (`PATCH /api/admin/reviews/:id`) that already existed from Plan 3. Reports still arrive out-of-band (support ticket, phone call) — this only closes the "find the review" gap, not a full in-system flagging system.
- **Categories** — `POST`/`PATCH /api/admin/categories` (create + rename only, no delete, since `salon_services.category_id` has a FK to it).
- **Users & salons** — `GET /api/admin/users` (searchable) + `PATCH /api/admin/users/:id/status`; a suspended user is blocked at both login (`verify-otp`) and mid-session (`AuthGuard`, since sessions last 30 days). Salon search reuses the same endpoint the approval queue uses, with a `status=all` option added for the broader search use case.
- **Config** — `GET`/`PATCH /api/admin/config`, a generic numeric key/value editor over `platform_config` — no per-key curation, so new tunables added elsewhere show up automatically.

No audit log of admin actions, no first-admin bootstrap script (stays a manual DB update, same as before this plan) — both explicit MVP scope cuts, documented in the design spec.
```

- [ ] **Step 4: Fix CLAUDE.md's Known Gaps section**

Modify `CLAUDE.md`'s `## Known Gaps / Future Plans` section:

```markdown
## Known Gaps / Future Plans

Carried forward across every plan shipped so far — check these are still accurate before assuming otherwise:

- **No real payment refunds.** No real alerting/paging on the `logger.error(...)` calls that flag payments needing manual review — both are explicit MVP scope cuts, not bugs.
- **No admin action audit log.** Salon approve/reject/suspend, review moderation, and user suspend all overwrite state with no history of who did it or when.
- **No first-admin bootstrap.** Promoting a user to `role: 'admin'` is a manual DB update — there's no self-service admin signup, by design.
- **Blog/content-marketing CMS** is a separate, not-yet-started future plan (backend module + admin editor + public pages) — out of scope for every plan so far.
```

(This removes three bullets that are no longer true — salon photo upload and the approval workflow both shipped in Plans 5-6, and "Provider Panel and Admin Panel are both unstarted" is now simply false — and fixes the blog CMS bullet's stale "Plan 5" reference, since Plan 5 turned out to be Provider Panel, not the blog CMS.)

- [ ] **Step 5: Run the entire repo's test suite one final time**

Run: `pnpm --filter @gheychi/api test && pnpm --filter @gheychi/api test:e2e`
Expected: all suites pass

Run: `pnpm --filter @gheychi/provider-panel test -- --run && pnpm --filter @gheychi/provider-panel typecheck`
Expected: 12 files, 37 tests passed; no typecheck errors

Run: `pnpm --filter @gheychi/admin-panel test -- --run && pnpm --filter @gheychi/admin-panel typecheck`
Expected: 8 files, 27 tests passed; no typecheck errors

Run: `pnpm --filter @gheychi/admin-panel test:e2e`
Expected: PASS (1 test)

Run: `pnpm --filter @gheychi/user-app test -- --run`
Expected: unaffected, still passing (sanity check that nothing in this plan touched shared infrastructure user-app also depends on)

Run: `pnpm build`
Expected: all four workspace packages (`api`, `user-app`, `provider-panel`, `admin-panel`) build cleanly

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: document Plan 6 (Admin Panel) and fix Plan 5 doc staleness

README's Structure section and CLAUDE.md's Known Gaps section both still
said provider-panel/salon-approval/photo-upload were unstarted gaps --
apparently missed when Plan 5 itself wrapped up. Corrects those and adds
Plan 6's own documentation in the same pass."
```

---

## Summary

24 backend/frontend tasks (Tasks 1-4 scaffold, 5-13 Slice 1, 14-15 Slice 2, 16-17 Slice 3, 18-21 Slice 4, 22-23 Slice 5, 24 e2e, 25 docs) take the Admin Panel from "doesn't exist" to a working Vue 3 SPA covering all five areas from the original design doc, closing the loop Provider Panel left open: salon approval no longer requires a manual database update anywhere in the system.
