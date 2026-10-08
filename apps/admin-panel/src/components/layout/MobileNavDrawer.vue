<!-- apps/admin-panel/src/components/layout/MobileNavDrawer.vue -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import AppIcon from '@/components/ui/AppIcon.vue'
import SidebarNav from './SidebarNav.vue'

// Off-canvas navigation for screens below `md`, where the fixed 16rem sidebar would eat
// most of the viewport. Same SidebarNav (labels and section headings included) as the
// desktop sidebar -- only the chrome differs.
const open = defineModel<boolean>({ required: true })

const route = useRoute()
const panel = ref<HTMLElement | null>(null)
const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

function close() {
  open.value = false
}

// Closes on navigation. SidebarNav also emits on a click of the already-active link, which
// changes no route and so would otherwise leave the drawer covering the page.
watch(() => route.fullPath, close)

function focusables(): HTMLElement[] {
  return panel.value ? Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)) : []
}

// Focus trap: Tab / Shift+Tab wrap inside the panel instead of walking into the (inert-looking
// but still tabbable) page behind the backdrop.
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    close()
    return
  }
  if (e.key !== 'Tab') return
  const items = focusables()
  if (items.length === 0) return
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement
  if (e.shiftKey && (active === first || !panel.value?.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !panel.value?.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}

// Wide enough to switch to the desktop sidebar while open (rotating a tablet): the drawer's
// own `md:hidden` hides it, this releases the scroll lock and state it would otherwise keep.
const wide = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 768px)') : null
function onBreakpoint(e: MediaQueryListEvent) {
  if (e.matches) close()
}
wide?.addEventListener?.('change', onBreakpoint)

let previousOverflow = ''
function lockScroll(lock: boolean) {
  if (lock) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = previousOverflow
  }
}

watch(open, async (isOpen, wasOpen) => {
  lockScroll(isOpen)
  if (isOpen) {
    await nextTick()
    // The close button first: a predictable landing spot that is never mid-list.
    panel.value?.querySelector<HTMLElement>('[data-drawer-close]')?.focus()
  } else if (wasOpen) {
    // Focus return to the hamburger is the parent's job (it owns the trigger element).
  }
})

onBeforeUnmount(() => {
  wide?.removeEventListener?.('change', onBreakpoint)
  if (open.value) lockScroll(false)
})
</script>

<template>
  <!-- Backdrop and panel are separate transitions: a fade and a slide share neither the
       property nor the duration. Both are 200ms, and main.css zeroes them under
       prefers-reduced-motion. -->
  <div class="md:hidden" @keydown="onKeydown">
    <Transition name="drawer-fade">
      <div
        v-if="open"
        data-testid="drawer-backdrop"
        class="fixed inset-0 z-40 bg-black/50"
        aria-hidden="true"
        @click="close"
      />
    </Transition>
    <Transition name="drawer-slide">
      <div
        v-if="open"
        id="mobile-nav-drawer"
        ref="panel"
        data-testid="mobile-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="منو"
        class="fixed inset-y-0 start-0 z-50 flex w-72 max-w-[85vw] flex-col border-e border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-lg)"
      >
        <div class="flex shrink-0 items-center justify-between border-b border-(--color-border-soft) px-4 py-3">
          <span class="text-base font-bold text-(--color-text)">منو</span>
          <button
            type="button"
            data-drawer-close
            aria-label="بستن منو"
            class="flex h-11 w-11 items-center justify-center rounded-xl text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text)"
            @click="close"
          >
            <AppIcon name="x" :size="20" />
          </button>
        </div>
        <div class="flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav @navigate="close" />
        </div>
      </div>
    </Transition>
  </div>
</template>
