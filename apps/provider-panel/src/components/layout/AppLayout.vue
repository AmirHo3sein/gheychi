<!-- apps/provider-panel/src/components/layout/AppLayout.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import { unbindPushBeforeLogout } from '@/composables/usePushNotifications'
import { useApi } from '@/composables/useApi'
import { resetPendingApprovals, usePendingApprovalCount, usePendingApprovalPolling } from '@/composables/usePendingApprovals'
import { resetSalon, useSalon } from '@/composables/useSalon'
import { useTheme } from '@/composables/useTheme'
import { useSessionStore } from '@/stores/session'
import ConfirmSheet from '@/components/ui/ConfirmSheet.vue'
import { formatNumber } from '@/utils/digits'
import BottomNav from './BottomNav.vue'
import { NAV_GROUPS, isNavActive } from './nav-config'

const route = useRoute()
const router = useRouter()
const { apiFetch } = useApi()
const { salon } = useSalon()
const { isDark, setPreference } = useTheme()
const session = useSessionStore()

usePendingApprovalPolling()
const pendingCount = usePendingApprovalCount()
const pendingDescription = computed(() => `${formatNumber(pendingCount.value)} درخواست در انتظار تأیید`)

function toggleTheme() {
  setPreference(isDark.value ? 'light' : 'dark')
}

async function logout() {
  // While the session still exists: DELETE /push/subscribe is scoped to the signed-in account.
  await unbindPushBeforeLogout()
  await apiFetch('/auth/logout', { method: 'POST', silent: true })
  session.setUser(null)
  // useSalon() is a module-level singleton the router guard only probes while `checked`
  // is false -- without this, the next account to log in on this tab would be routed on
  // the previous owner's salon (or, after an onboarding-only session, sent to onboarding
  // despite owning an approved salon). The pending-approval count is the same kind of
  // singleton and would otherwise show the previous salon's badge.
  resetSalon()
  resetPendingApprovals()
  await router.push('/login')
}
</script>

<template>
  <!--
    min-h-dvh, not min-h-screen: on mobile Safari/Chrome 100vh is the *large* viewport, so
    the last row of a full-height screen hides behind the collapsing URL bar.

    Below lg: a slim top bar plus the fixed BottomNav, whose height (plus the iOS
    home-indicator inset) the bottom padding clears. From lg: a fixed sidebar on the inline
    START edge -- the right in this RTL app -- and the content beside it, so `ps-*` reserves
    its width with a logical property rather than a hard-coded `pr-*`.
  -->
  <div class="min-h-dvh bg-(--color-surface) pb-[calc(5rem+env(safe-area-inset-bottom))] lg:ps-68 lg:pb-0">
    <!-- First tab stop: keyboard users skip the top bar / sidebar nav straight to the page. -->
    <a
      href="#main-content"
      data-testid="skip-to-content"
      class="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:inline-flex focus:min-h-11 focus:items-center focus:rounded-xl focus:bg-(--color-surface-card) focus:px-4 focus:text-sm focus:font-bold focus:text-(--color-accent-text) focus:shadow-(--shadow-md) focus:ring-2 focus:ring-(--color-accent-text) focus:outline-none"
    >پرش به محتوای اصلی</a>
    <!--
      Top bar at every width: the salon name plus the account controls (theme, logout).
      Below lg navigation lives in the bottom bar; from lg the sidebar holds it, and this bar
      sits beside the sidebar (the wrapper's `lg:ps-68` offsets it) at the same 4rem height
      as the sidebar's brand row, so the two bottom borders line up.
    -->
    <header class="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-(--color-border) bg-(--color-surface-card)/90 px-4 shadow-(--shadow-sm) backdrop-blur lg:px-6 lg:shadow-none">
      <!-- Decorative: the salon name sits right beside it. The sidebar carries the mark on lg. -->
      <img src="/brand-icon.png" alt="" class="h-9 w-9 shrink-0 rounded-xl shadow-(--shadow-sm) lg:hidden" />
      <AppIcon name="store" :size="20" class="hidden shrink-0 text-(--color-accent-text-strong) lg:block" />
      <div class="min-w-0 flex-1">
        <p data-testid="header-salon-name" class="truncate text-sm font-bold text-(--color-text) lg:text-base" :title="salon?.name">{{ salon?.name ?? 'پنل سالن' }}</p>
        <p class="text-xs text-(--color-text-muted) lg:hidden">قیچی · پنل سالن</p>
      </div>
      <button
        type="button"
        :title="isDark ? 'حالت روشن' : 'حالت تیره'"
        :aria-label="isDark ? 'حالت روشن' : 'حالت تیره'"
        class="flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl text-sm font-medium text-(--color-text-muted) transition-colors duration-150 hover:bg-(--color-border-soft) hover:text-(--color-text) lg:px-3"
        @click="toggleTheme"
      >
        <AppIcon :name="isDark ? 'sun' : 'moon'" :size="18" />
        <span class="hidden lg:inline" aria-hidden="true">{{ isDark ? 'حالت روشن' : 'حالت تیره' }}</span>
      </button>
      <button
        type="button"
        title="خروج"
        aria-label="خروج"
        class="flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl text-sm font-medium text-(--color-text-muted) transition-colors duration-150 hover:bg-(--tone-danger-bg) hover:text-(--tone-danger-text) lg:px-3"
        @click="logout"
      >
        <AppIcon name="logout" :size="18" />
        <span class="hidden lg:inline" aria-hidden="true">خروج</span>
      </button>
    </header>

    <!--
      Desktop sidebar (lg+). Fixed to the inline-start edge (`start-0` = right in RTL) at full
      height; its own nav scrolls if the viewport is short, so the brand lockup stays put. The
      salon name and account controls live in the top bar. Every destination of the panel is here, grouped -- there is
      no second navigation level on a desktop.
    -->
    <aside
      class="fixed inset-y-0 start-0 z-30 hidden w-68 flex-col border-e border-(--color-border) bg-(--color-surface-card) lg:flex"
      aria-label="نوار کناری"
    >
      <div class="flex h-16 shrink-0 items-center gap-3 border-b border-(--color-border) px-5">
        <img src="/brand-icon.png" alt="" class="h-10 w-10 shrink-0 rounded-xl shadow-(--shadow-sm)" />
        <div class="min-w-0 leading-tight">
          <p class="text-lg font-extrabold text-(--color-text)">قیچی</p>
          <p class="text-xs font-medium text-(--color-text-muted)">پنل سالن</p>
        </div>
      </div>

      <nav class="flex-1 overflow-y-auto px-3 py-4" aria-label="ناوبری اصلی">
        <section v-for="group in NAV_GROUPS" :key="group.key" class="mb-4 last:mb-0" :aria-labelledby="`nav-group-${group.key}`">
          <h2 :id="`nav-group-${group.key}`" class="mb-1 px-3 text-xs font-semibold text-(--color-text-muted)">{{ group.label }}</h2>
          <ul class="space-y-0.5">
            <li v-for="item in group.items" :key="item.to">
              <RouterLink
                :to="item.to"
                :aria-current="isNavActive(item.to, route.path) ? 'page' : undefined"
                :aria-describedby="item.pendingBadge && pendingCount > 0 ? 'sidebar-pending-desc' : undefined"
                :data-testid="item.to === '/referral' ? 'nav-referral' : `sidebar-link-${item.to === '/' ? 'dashboard' : item.to.slice(1)}`"
                class="relative flex min-h-10 items-center gap-3 rounded-xl px-3.5 text-sm transition-colors duration-150"
                :class="
                  isNavActive(item.to, route.path)
                    ? 'bg-(--color-accent-soft) font-semibold text-(--color-accent-text)'
                    : 'font-medium text-(--color-text-muted) hover:bg-(--color-border-soft) hover:text-(--color-text)'
                "
              >
                <!-- Start-edge bar on the active item: a second cue besides colour. -->
                <span
                  v-if="isNavActive(item.to, route.path)"
                  class="absolute inset-y-2.5 start-1 w-0.75 rounded-full bg-(--color-accent-text)"
                  aria-hidden="true"
                />
                <AppIcon :name="item.icon" :size="18" class="shrink-0" />
                <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                <!-- aria-hidden: the link's accessible name stays exactly its label (e2e
                     suites find «نوبت‌ها» by exact name); the count is announced through
                     aria-describedby instead. -->
                <span
                  v-if="item.pendingBadge && pendingCount > 0"
                  data-testid="nav-pending-badge"
                  aria-hidden="true"
                  class="tnum min-w-6 rounded-full bg-(--color-accent) px-1.5 py-0.5 text-center text-xs font-bold text-(--color-fill-text)"
                >{{ formatNumber(pendingCount) }}</span>
              </RouterLink>
            </li>
          </ul>
        </section>
        <span id="sidebar-pending-desc" class="sr-only">{{ pendingDescription }}</span>
      </nav>

    </aside>

    <main id="main-content" tabindex="-1" class="route-outlet focus:outline-none">
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

    <BottomNav :pending-count="pendingCount" />
    <ConfirmSheet />
  </div>
</template>
