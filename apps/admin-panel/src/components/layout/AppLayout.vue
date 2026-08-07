<!-- apps/admin-panel/src/components/layout/AppLayout.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'
import { useTheme } from '@/composables/useTheme'
import { useSessionStore } from '@/stores/session'
import { userRoleLabel } from '@/utils/labels'
import NotificationBell from './NotificationBell.vue'
import SidebarNav from './SidebarNav.vue'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const { apiFetch } = useApi()
const { isDark, setPreference } = useTheme()

function toggleTheme() {
  setPreference(isDark.value ? 'light' : 'dark')
}

const initial = computed(() => (session.user?.name?.trim()?.[0] ?? session.user?.phone?.slice(-2) ?? '؟'))

async function logout() {
  await apiFetch('/auth/logout', { method: 'POST', silent: true })
  session.setUser(null)
  await router.push('/login')
}
</script>

<template>
  <div class="flex h-screen overflow-hidden bg-(--color-surface)">
    <SidebarNav />
    <!-- `min-w-0` is load-bearing, not decoration: a flex child defaults to
         `min-width: auto`, so this column would refuse to shrink below its widest page and
         push the sidebar off-screen. `overflow-hidden` already implies a 0 automatic minimum
         size, but stating it keeps the guarantee from silently disappearing if the overflow
         value is ever relaxed. -->
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <!-- `flex-wrap` + `gap-y`: from `md` up everything fits on one line exactly as before,
           but on a narrow screen the action cluster drops to a second row instead of pushing
           the logout button out through the parent's `overflow-hidden`, where it would be
           both clipped and unreachable (no scroll to recover it). -->
      <header class="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-(--color-border) bg-(--color-surface-card) px-4 py-3.5 sm:px-6">
        <!-- Decorative: the panel name is already the adjacent <h1>, so an alt here would
             just be read out twice. The artwork carries its own peach field, hence no
             bg-* utility -- rounded-xl clips it to the same silhouette the mark had. -->
        <img src="/brand-icon.png" alt="" class="h-9 w-9 shrink-0 rounded-xl shadow-(--shadow-sm)" />

        <div class="h-6 w-px bg-(--color-border)" />

        <h1 class="min-w-0 truncate text-base font-bold text-(--color-text)">{{ route.meta.title ?? '' }}</h1>

        <!-- `ms-auto`, not `mr-auto`: identical in this RTL-only app, but the logical
             property is the one that stays correct if a direction ever changes. -->
        <div class="ms-auto flex min-w-0 items-center gap-2">
          <button
            type="button"
            :title="isDark ? 'حالت روشن' : 'حالت تیره'"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text)"
            @click="toggleTheme"
          >
            <AppIcon :name="isDark ? 'sun' : 'moon'" :size="18" />
          </button>

          <NotificationBell />

          <div class="mx-1 h-6 w-px bg-(--color-border)" />

          <!-- min-w-0 so the inner `truncate` can actually engage: without it this wrapper
               keeps its content-based minimum width and a long account name widens the whole
               header instead of being ellipsised. -->
          <div class="flex min-w-0 items-center gap-2.5 rounded-xl py-1 pe-1 ps-2">
            <div class="min-w-0 text-right leading-tight">
              <p class="truncate text-sm font-semibold text-(--color-text)">{{ session.user?.name || session.user?.phone }}</p>
              <p class="text-[11px] text-(--color-text-muted)">{{ userRoleLabel(session.user?.role ?? '') }}</p>
            </div>
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--tone-info-bg) text-sm font-bold text-(--color-accent-text)">
              {{ initial }}
            </div>
          </div>

          <button
            type="button"
            title="خروج"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-colors hover:bg-(--tone-danger-bg) hover:text-(--tone-danger-text)"
            @click="logout"
          >
            <AppIcon name="logout" :size="18" />
          </button>
        </div>
      </header>
      <!-- Explicitly `overflow-auto`, not just `overflow-y-auto`: this is the app's single
           horizontal scroll container. A page that is genuinely too wide for the viewport
           (the dense tables this admin tool is built around) scrolls here, so the document
           body itself never gets a horizontal scrollbar at any width. -->
      <main class="route-outlet flex-1 overflow-auto">
        <!--
          No `mode="out-in"` here -- deliberately. Every route component below is lazy
          (`() => import(...)` in router/index.ts), which Vue Router hands this slot as an
          async component. `mode="out-in"` waits for the leave transition to finish, THEN
          mounts the incoming node and waits for its own enter hooks before considering the
          cycle done -- but the first time an incoming async component doesn't resolve
          synchronously (a not-yet-cached chunk: echarts, markdown-it, vue-multiselect are all
          only pulled in by specific routes), that wait never resolves and Transition's out-in
          state machine gets permanently wedged. Every navigation after that swaps `Component`
          correctly but the transition wrapper never mounts it, leaving the header/nav live
          over a blank <main> until a full reload resets Vue's tree. Default (simultaneous)
          mode has no such wait, at the cost of old/new briefly overlapping during the fade
          instead of a clean sequential swap -- confirmed via a scripted multi-route
          navigation sweep that this trade eliminates the wedge entirely.
        -->
        <RouterView v-slot="{ Component, route: current }">
          <Transition name="page-fade">
            <component :is="Component" :key="current.path" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>
