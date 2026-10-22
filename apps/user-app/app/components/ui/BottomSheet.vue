<script setup lang="ts">
import { lockBodyScroll } from '../../utils/scroll-lock'

// A phone bottom sheet: slides up from the bottom edge, closes by the ✕ button, a tap on the
// backdrop, Escape, or dragging the handle/header down past a threshold. Always mounted by the
// caller and driven by `open`, so the slide-down plays on close too (a `v-if` at the call site
// would remove it instantly). Focus trap/restore and Escape come from useDialog; the OS
// "reduce motion" setting is honoured by main.css's global rule (the slide becomes instant).
const props = defineProps<{ open: boolean; title: string }>()
const emit = defineEmits<{ close: [] }>()

defineOptions({ inheritAttrs: false })

const dialogRoot = ref<HTMLElement | null>(null)
const { titleId } = useDialog(dialogRoot as unknown as Ref<HTMLElement | null>, {
  onClose: () => emit('close'),
  enabled: () => props.open,
})

let unlockScroll: (() => void) | null = null
watch(
  () => props.open,
  (open) => {
    if (open) unlockScroll ??= lockBodyScroll()
    else {
      unlockScroll?.()
      unlockScroll = null
    }
  },
  { immediate: true },
)
onBeforeUnmount(() => unlockScroll?.())

// Drag to dismiss: follow the finger downward only; past 25% of the sheet's height (or a quick
// flick) it closes, otherwise it springs back.
const dragY = ref(0)
const dragging = ref(false)
let startY = 0
let startT = 0
function onPointerDown(e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  dragging.value = true
  startY = e.clientY
  startT = e.timeStamp
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
}
function onPointerMove(e: PointerEvent) {
  if (!dragging.value) return
  dragY.value = Math.max(0, e.clientY - startY)
}
function onPointerUp(e: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  const height = dialogRoot.value?.offsetHeight || 400
  const velocity = dragY.value / Math.max(1, e.timeStamp - startT)
  if (dragY.value > height * 0.25 || (dragY.value > 30 && velocity > 0.6)) emit('close')
  else dragY.value = 0
}
// Reset the offset once the sheet is gone, so the next open starts from the bottom edge.
function onAfterLeave() {
  dragY.value = 0
}
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-200 ease-out"
      enter-from-class="opacity-0"
      leave-active-class="transition-opacity duration-200 ease-in"
      leave-to-class="opacity-0"
    >
      <div v-if="open" class="fixed inset-0 z-50 bg-black/40" aria-hidden="true" data-testid="bottom-sheet-backdrop" @click="emit('close')" />
    </Transition>
    <Transition
      enter-active-class="transition-transform duration-300 ease-out"
      enter-from-class="translate-y-full"
      leave-active-class="transition-transform duration-200 ease-in"
      leave-to-class="translate-y-full"
      @after-leave="onAfterLeave"
    >
      <div
        v-if="open"
        v-bind="$attrs"
        ref="dialogRoot"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        class="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-3xl border border-b-0 border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-lg) outline-none"
        :class="dragging ? '' : 'transition-transform duration-200'"
        :style="dragY ? { transform: `translateY(${dragY}px)` } : undefined"
      >
        <div
          class="shrink-0 cursor-grab touch-none select-none px-4 pt-2 pb-3 active:cursor-grabbing"
          data-testid="bottom-sheet-handle"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerUp"
        >
          <div class="mx-auto mb-2 h-1.5 w-10 rounded-full bg-(--color-border)" aria-hidden="true" />
          <div class="flex items-center justify-between gap-3">
            <h2 :id="titleId" class="text-base font-bold text-(--color-text)">{{ title }}</h2>
            <button
              type="button"
              aria-label="بستن"
              data-testid="bottom-sheet-close"
              class="inline-flex h-10 w-10 items-center justify-center rounded-full text-(--color-text-muted) transition-colors hover:bg-(--color-surface-subtle) hover:text-(--color-text)"
              @pointerdown.stop
              @click="emit('close')"
            >
              <BaseIcon name="x" :size="18" />
            </button>
          </div>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
