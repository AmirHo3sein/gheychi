<!-- apps/provider-panel/src/components/layout/AppLayout.vue -->
<script setup lang="ts">
import { useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'
import { useSalon } from '@/composables/useSalon'
import { useTheme } from '@/composables/useTheme'
import { useSessionStore } from '@/stores/session'
import BottomNav from './BottomNav.vue'

const router = useRouter()
const { apiFetch } = useApi()
const { salon } = useSalon()
const { isDark, setPreference } = useTheme()
const session = useSessionStore()

function toggleTheme() {
  setPreference(isDark.value ? 'light' : 'dark')
}

async function logout() {
  await apiFetch('/auth/logout', { method: 'POST', silent: true })
  session.setUser(null)
  await router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-(--color-surface) pb-20">
    <header class="sticky top-0 z-30 flex items-center gap-3 border-b border-(--color-border) bg-(--color-surface-card)/90 px-4 py-3 backdrop-blur">
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--color-accent) font-black text-white shadow-(--shadow-sm)">
        ق
      </div>
      <p class="min-w-0 truncate text-sm font-bold text-(--color-text)">{{ salon?.name ?? 'پنل مدیریت آرایشگاه' }}</p>

      <div class="mr-auto flex items-center gap-1">
        <button
          type="button"
          :title="isDark ? 'حالت روشن' : 'حالت تیره'"
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text)"
          @click="toggleTheme"
        >
          <AppIcon :name="isDark ? 'sun' : 'moon'" :size="18" />
        </button>
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

    <main>
      <RouterView v-slot="{ Component, route: current }">
        <Transition name="page-fade" mode="out-in">
          <component :is="Component" :key="current.path" />
        </Transition>
      </RouterView>
    </main>

    <BottomNav />
  </div>
</template>
