<!-- apps/admin-panel/src/components/ui/ScrollTable.vue -->
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, onUpdated, ref } from 'vue'

// Horizontal scroller for the dense data tables. A bare `overflow-x-auto` div scrolls on a
// phone but gives no hint that it does (the themed scrollbar is thin, and touch browsers hide
// it), so columns past the edge simply look like they don't exist. This adds:
//   - an edge shadow on each side that still has content in that direction (and only then),
//   - a focusable `region` landmark with an accessible name, so keyboard users can scroll it
//     with the arrow keys instead of being unable to reach the trailing columns.
// The wrapped <table> keeps a floor width so columns don't collapse into one-word-per-line
// slivers; the first column keeps a minimum width so the row's identity stays readable
// while the rest scrolls past.
defineProps<{ label: string }>()

const scroller = ref<HTMLElement | null>(null)
const moreAtStart = ref(false)
const moreAtEnd = ref(false)

// `Math.abs(scrollLeft)`: in RTL the scroll origin is the right edge and scrollLeft runs
// 0 -> -max, so the absolute value is "distance scrolled from the inline-start edge" in
// either direction. start/end below are therefore LOGICAL, not left/right.
function update() {
  const el = scroller.value
  if (!el) return
  const max = el.scrollWidth - el.clientWidth
  const pos = Math.abs(el.scrollLeft)
  moreAtStart.value = pos > 1
  moreAtEnd.value = max - pos > 1
}

let observer: ResizeObserver | undefined
onMounted(() => {
  update()
  if (typeof ResizeObserver !== 'undefined' && scroller.value) {
    observer = new ResizeObserver(update)
    observer.observe(scroller.value)
    if (scroller.value.firstElementChild) observer.observe(scroller.value.firstElementChild)
  }
})
// Rows arriving after the first paint change the scroll width without resizing the scroller.
onUpdated(() => nextTick(update))
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <div class="relative">
    <div
      ref="scroller"
      role="region"
      tabindex="0"
      :aria-label="label"
      class="overflow-x-auto focus-visible:outline-offset-[-2px] [&_table]:min-w-136 [&_td:first-child]:min-w-36 [&_th:first-child]:min-w-36"
      @scroll.passive="update"
    >
      <slot />
    </div>
    <div
      v-show="moreAtStart"
      data-testid="scroll-fade-start"
      aria-hidden="true"
      class="pointer-events-none absolute inset-y-0 start-0 w-6 from-transparent to-[color-mix(in_srgb,var(--color-text)_14%,transparent)] ltr:bg-linear-to-l rtl:bg-linear-to-r"
    />
    <div
      v-show="moreAtEnd"
      data-testid="scroll-fade-end"
      aria-hidden="true"
      class="pointer-events-none absolute inset-y-0 end-0 w-6 from-transparent to-[color-mix(in_srgb,var(--color-text)_14%,transparent)] ltr:bg-linear-to-r rtl:bg-linear-to-l"
    />
  </div>
</template>
