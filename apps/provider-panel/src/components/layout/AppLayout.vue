<!-- apps/provider-panel/src/components/layout/AppLayout.vue -->
<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'
import { resetSalon, useSalon } from '@/composables/useSalon'
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
  // useSalon() is a module-level singleton the router guard only probes while `checked`
  // is false -- without this, the next account to log in on this tab would be routed on
  // the previous owner's salon (or, after an onboarding-only session, sent to onboarding
  // despite owning an approved salon).
  resetSalon()
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
    <!--
      Three flex regions (brand / nav / controls), brand and controls both `flex-1` -- that's
      what actually centers `nav` in the leftover space instead of just shoving it against
      whichever side has `ms-auto`. Below lg, `nav` is hidden and the two flex-1 regions
      collapse back to the original brand-left / controls-right layout with nothing between
      them, so mobile is unaffected.
    -->
    <header class="sticky top-0 z-30 flex items-center gap-3 border-b border-(--color-border) bg-(--color-surface-card)/90 px-4 py-2.5 shadow-(--shadow-sm) backdrop-blur lg:px-6">
      <div class="flex min-w-0 flex-1 items-center gap-3">
        <!-- Decorative: the salon name sits right beside it. The artwork carries its own
             peach field, hence no bg-* utility -- rounded-xl clips it to the same silhouette. -->
        <img
          src="/brand-icon.png"
          alt=""
          class="h-9 w-9 shrink-0 rounded-xl shadow-(--shadow-sm) transition-transform duration-200 hover:scale-105 hover:rotate-3"
        />
        <p class="min-w-0 truncate text-sm font-bold text-(--color-text)">{{ salon?.name ?? 'پنل مدیریت آرایشگاه' }}</p>
      </div>

      <!--
        Desktop/laptop navigation. The same five destinations the bottom bar carries, moved
        inline from lg up so a wide screen isn't left with a phone bar spanning 1920px. The
        bar and this row are mutually exclusive (lg:hidden / hidden lg:flex), never both.
      -->
      <nav class="hidden shrink-0 items-center gap-1 lg:flex" aria-label="ناوبری اصلی">
        <RouterLink
          v-for="tab in NAV_TABS"
          :key="tab.to"
          :to="tab.to"
          class="group relative flex min-h-11 items-center gap-2 whitespace-nowrap rounded-xl px-3 text-sm font-medium transition-all duration-200 active:scale-[0.97]"
          :class="
            isTabActive(tab.to, route.path)
              ? 'bg-(--color-accent-soft) text-(--color-accent-text)'
              : 'text-(--color-text-muted) hover:-translate-y-0.5 hover:bg-(--color-border-soft) hover:text-(--color-text)'
          "
        >
          <AppIcon :name="tab.icon" :size="17" class="transition-transform duration-200 group-hover:scale-110" />
          {{ tab.label }}
        </RouterLink>
      </nav>

      <div class="flex flex-1 items-center justify-end gap-1">
        <!--
          The referral/wallet screen's entry point. Not a sixth NAV_TAB: the bottom bar's
          five destinations are already sized against 320px / 5 = 64px apiece (see
          BottomNav.vue), and a sixth would shrink every primary destination to make room
          for a screen an owner visits occasionally. It also cannot live in the dashboard's
          quick-link grid, where the other secondary screens are reached, because it must be
          reachable from the wallet-bearing screens themselves. A header affordance is
          present at every width and on every route without costing the nav anything.
        -->
        <RouterLink
          to="/referral"
          title="معرفی و پاداش"
          aria-label="معرفی و پاداش"
          data-testid="nav-referral"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-all duration-200 hover:bg-(--color-border-soft) active:scale-90"
          :class="route.path === '/referral' ? 'bg-(--color-accent-soft) text-(--color-accent-text)' : 'text-(--color-text-muted) hover:text-(--color-text)'"
        >
          <AppIcon name="referral" :size="18" />
        </RouterLink>
        <button
          type="button"
          :title="isDark ? 'حالت روشن' : 'حالت تیره'"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-all duration-200 hover:bg-(--color-border-soft) hover:text-(--color-text) active:scale-90"
          @click="toggleTheme"
        >
          <AppIcon :name="isDark ? 'sun' : 'moon'" :size="18" />
        </button>
        <button
          type="button"
          title="خروج"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-all duration-200 hover:bg-(--tone-danger-bg) hover:text-(--tone-danger-text) active:scale-90"
          @click="logout"
        >
          <AppIcon name="logout" :size="18" />
        </button>
      </div>
    </header>

    <main class="route-outlet">
      <!--
        No `mode="out-in"` here -- deliberately. Every route component below is lazy
        (`() => import(...)` in router/index.ts), which Vue Router hands this slot as an
        async component. `mode="out-in"` waits for the leave transition to finish, THEN mounts
        the incoming node and waits for its own enter hooks before considering the cycle done
        -- but the first time an incoming async component doesn't resolve synchronously (a
        not-yet-cached chunk: leaflet/vue-multiselect are only pulled in by the
        onboarding/settings pickers), that wait never resolves and Transition's out-in state
        machine gets permanently wedged. Every navigation after that swaps `Component`
        correctly but the transition wrapper never mounts it, leaving the header/nav live over
        a blank <main> until a full reload resets Vue's tree. Default (simultaneous) mode has
        no such wait, at the cost of old/new briefly overlapping during the fade instead of a
        clean sequential swap -- confirmed via a scripted multi-route navigation sweep that
        this trade eliminates the wedge entirely.
      -->
      <RouterView v-slot="{ Component, route: current }">
        <Transition name="page-fade">
          <component :is="Component" :key="current.path" />
        </Transition>
      </RouterView>
    </main>

    <BottomNav />
  </div>
</template>
