<!-- apps/provider-panel/src/components/layout/AppLayout.vue -->
<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'
import { useSalon } from '@/composables/useSalon'
import { useTheme } from '@/composables/useTheme'
import { useSessionStore } from '@/stores/session'
import BottomNav from './BottomNav.vue'
import { NAV_TABS, isTabActive } from './nav-tabs'

const route = useRoute()
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
  <!--
    min-h-dvh, not min-h-screen: on mobile Safari/Chrome 100vh is the *large* viewport, so
    the last row of a full-height screen hides behind the collapsing URL bar.

    The bottom padding clears the fixed BottomNav (plus the iOS home-indicator inset the nav
    itself also pads for), and drops to zero at lg where the nav moves into the header.
  -->
  <div class="min-h-dvh bg-(--color-surface) pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
    <header class="sticky top-0 z-30 flex items-center gap-3 border-b border-(--color-border) bg-(--color-surface-card)/90 px-4 py-2.5 backdrop-blur lg:px-6">
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--color-accent) font-black text-white shadow-(--shadow-sm)">
        ق
      </div>
      <p class="min-w-0 truncate text-sm font-bold text-(--color-text)">{{ salon?.name ?? 'پنل مدیریت آرایشگاه' }}</p>

      <!--
        Desktop/laptop navigation. The same five destinations the bottom bar carries, moved
        inline from lg up so a wide screen isn't left with a phone bar spanning 1920px. The
        bar and this row are mutually exclusive (lg:hidden / hidden lg:flex), never both.
      -->
      <nav class="ms-auto hidden shrink-0 items-center gap-1 lg:flex">
        <RouterLink
          v-for="tab in NAV_TABS"
          :key="tab.to"
          :to="tab.to"
          class="flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition-colors"
          :class="
            isTabActive(tab.to, route.path)
              ? 'bg-(--color-accent-soft) text-(--color-accent-text)'
              : 'text-(--color-text-muted) hover:bg-(--color-border-soft) hover:text-(--color-text)'
          "
        >
          <AppIcon :name="tab.icon" :size="17" />
          {{ tab.label }}
        </RouterLink>
      </nav>

      <!-- ms-auto (logical), not mr-auto: physical directions are forbidden app-wide, and
           this one only happened to look right because the app is RTL-only. On lg the nav
           above already claims the free space, so this collapses to a plain gap. -->
      <div class="ms-auto flex items-center gap-1 lg:ms-2">
        <button
          type="button"
          :title="isDark ? 'حالت روشن' : 'حالت تیره'"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text)"
          @click="toggleTheme"
        >
          <AppIcon :name="isDark ? 'sun' : 'moon'" :size="18" />
        </button>
        <button
          type="button"
          title="خروج"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-colors hover:bg-(--tone-danger-bg) hover:text-(--tone-danger-text)"
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
