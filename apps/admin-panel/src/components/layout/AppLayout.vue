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
    <div class="flex flex-1 flex-col overflow-hidden">
      <header class="flex shrink-0 items-center gap-4 border-b border-(--color-border) bg-(--color-surface-card) px-6 py-3.5">
        <!-- Temporary logo mark, until a real brand asset exists -->
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--color-accent) font-black text-white shadow-(--shadow-sm)">
          آ
        </div>

        <div class="h-6 w-px bg-(--color-border)" />

        <h1 class="text-base font-bold text-(--color-text)">{{ route.meta.title ?? '' }}</h1>

        <div class="mr-auto flex items-center gap-2">
          <button
            type="button"
            :title="isDark ? 'حالت روشن' : 'حالت تیره'"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text)"
            @click="toggleTheme"
          >
            <AppIcon :name="isDark ? 'sun' : 'moon'" :size="18" />
          </button>

          <NotificationBell />

          <div class="mx-1 h-6 w-px bg-(--color-border)" />

          <div class="flex items-center gap-2.5 rounded-xl py-1 pe-1 ps-2">
            <div class="min-w-0 text-right leading-tight">
              <p class="truncate text-sm font-semibold text-(--color-text)">{{ session.user?.name || session.user?.phone }}</p>
              <p class="text-[11px] text-(--color-text-muted)">{{ userRoleLabel(session.user?.role ?? '') }}</p>
            </div>
            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--tone-info-bg) text-sm font-bold text-(--color-accent)">
              {{ initial }}
            </div>
          </div>

          <button
            type="button"
            title="خروج"
            class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-(--color-text-muted) transition-colors hover:bg-(--tone-danger-bg) hover:text-(--tone-danger-text)"
            @click="logout"
          >
            <AppIcon name="logout" :size="18" />
          </button>
        </div>
      </header>
      <main class="flex-1 overflow-y-auto">
        <RouterView v-slot="{ Component, route: current }">
          <Transition name="page-fade" mode="out-in">
            <component :is="Component" :key="current.path" />
          </Transition>
        </RouterView>
      </main>
    </div>
  </div>
</template>
