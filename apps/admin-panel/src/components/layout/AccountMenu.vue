<!-- apps/admin-panel/src/components/layout/AccountMenu.vue -->
<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useApi } from '@/composables/useApi'
import { useTheme } from '@/composables/useTheme'
import { useSessionStore } from '@/stores/session'
import { toPersianDigits } from '@/utils/digits'
import { userRoleLabel } from '@/utils/labels'

// The header's account cluster folded into one avatar button: theme and logout used to be two
// more icon buttons beside it, which pushed the phone header onto a second row (~125px of
// chrome). A menu-button pattern (WAI-ARIA APG): Enter/Space/ArrowDown open on the first item,
// arrows cycle, Escape/Tab close, and Escape hands focus back to the trigger.
const router = useRouter()
const session = useSessionStore()
const { apiFetch } = useApi()
const { isDark, setPreference } = useTheme()

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const open = ref(false)

// The first letter of the admin's own name. The old fallback, the last two phone digits
// ("01"), read as a number badge rather than a person -- with no name we show a person glyph.
const initial = computed(() => session.user?.name?.trim()?.[0] ?? '')
// No name on file -> the phone number (Persian digits) is the identity, never the role twice.
const displayPhone = computed(() => (session.user?.phone ? toPersianDigits(session.user.phone) : ''))
const displayName = computed(() => session.user?.name?.trim() || displayPhone.value || 'مدیر')
const hasName = computed(() => Boolean(session.user?.name?.trim()))
const themeLabel = computed(() => (isDark.value ? 'حالت روشن' : 'حالت تیره'))

function items(): HTMLElement[] {
  return menu.value ? Array.from(menu.value.querySelectorAll<HTMLElement>('[role="menuitem"]')) : []
}

async function openMenu(focusIndex: 0 | -1 = 0) {
  open.value = true
  await nextTick()
  const list = items()
  list.at(focusIndex)?.focus()
}

function closeMenu(returnFocus: boolean) {
  open.value = false
  if (returnFocus) trigger.value?.focus()
}

function onTriggerKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    openMenu(e.key === 'ArrowDown' ? 0 : -1)
  }
}

function onMenuKeydown(e: KeyboardEvent) {
  const list = items()
  const index = list.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeMenu(true)
  } else if (e.key === 'Tab') {
    closeMenu(false)
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    const step = e.key === 'ArrowDown' ? 1 : -1
    list[(index + step + list.length) % list.length]?.focus()
  } else if (e.key === 'Home' || e.key === 'End') {
    e.preventDefault()
    list.at(e.key === 'Home' ? 0 : -1)?.focus()
  }
}

function onDocumentPointer(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) closeMenu(false)
}
onMounted(() => document.addEventListener('mousedown', onDocumentPointer))
onUnmounted(() => document.removeEventListener('mousedown', onDocumentPointer))

function toggleTheme() {
  setPreference(isDark.value ? 'light' : 'dark')
}

async function logout() {
  closeMenu(false)
  await apiFetch('/auth/logout', { method: 'POST', silent: true })
  session.setUser(null)
  await router.push('/login')
}
</script>

<template>
  <div ref="root" class="relative">
    <button
      ref="trigger"
      type="button"
      data-testid="account-menu-button"
      aria-haspopup="menu"
      :aria-expanded="open"
      aria-controls="account-menu"
      :aria-label="`حساب کاربری: ${displayName}`"
      class="flex min-w-0 items-center gap-2.5 rounded-xl p-1 transition-colors hover:bg-(--color-border-soft) md:pe-2"
      @click="open ? closeMenu(false) : openMenu()"
      @keydown="onTriggerKeydown"
    >
      <span
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--color-accent) text-sm font-bold text-(--color-fill-text)"
        aria-hidden="true"
      >
        <template v-if="initial">{{ initial }}</template>
        <AppIcon v-else name="user" :size="18" />
      </span>
      <!-- Name and role only from `md` up; on a phone the avatar alone carries the menu. -->
      <span class="hidden min-w-0 text-start leading-tight md:block">
        <bdi class="block max-w-40 truncate text-sm font-semibold text-(--color-text)" :class="!hasName && 'tnum'" :dir="hasName ? undefined : 'ltr'">{{ displayName }}</bdi>
        <span class="block text-xs text-(--color-text-muted)">{{ userRoleLabel(session.user?.role ?? '') }}</span>
      </span>
      <AppIcon name="chevron-down" :size="16" class="hidden shrink-0 text-(--color-text-muted) md:block" />
    </button>

    <!-- v-show, not v-if: the items exist from first render so the menu never has to be
         rebuilt to be focused, and their names are queryable before it opens. -->
    <div
      v-show="open"
      id="account-menu"
      ref="menu"
      role="menu"
      aria-label="حساب کاربری"
      data-testid="account-menu"
      class="absolute end-0 z-50 mt-1.5 w-64 max-w-[calc(100vw-1rem)] rounded-2xl border border-(--color-border) bg-(--color-surface-card) p-1.5 shadow-(--shadow-md)"
      @keydown="onMenuKeydown"
    >
      <div class="mb-1 border-b border-(--color-border-soft) px-3 pb-2.5 pt-2" role="presentation">
        <p class="truncate text-sm font-bold text-(--color-text)"><bdi :dir="hasName ? undefined : 'ltr'">{{ displayName }}</bdi></p>
        <p class="mt-0.5 flex items-center gap-1.5 text-xs text-(--color-text-muted)">
          <span>{{ userRoleLabel(session.user?.role ?? '') }}</span>
          <template v-if="displayPhone && hasName">
            <span aria-hidden="true">·</span>
            <bdi dir="ltr" class="tnum">{{ displayPhone }}</bdi>
          </template>
        </p>
      </div>
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        :aria-label="themeLabel"
        class="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-(--color-text) transition-colors hover:bg-(--color-border-soft) focus-visible:bg-(--color-border-soft)"
        @click="toggleTheme"
      >
        <AppIcon :name="isDark ? 'sun' : 'moon'" :size="18" class="text-(--color-text-muted)" />
        {{ themeLabel }}
      </button>
      <button
        type="button"
        role="menuitem"
        tabindex="-1"
        aria-label="خروج"
        data-testid="logout-button"
        class="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-(--tone-danger-text) transition-colors hover:bg-(--tone-danger-bg) focus-visible:bg-(--tone-danger-bg)"
        @click="logout"
      >
        <AppIcon name="logout" :size="18" />
        خروج
      </button>
    </div>
  </div>
</template>
