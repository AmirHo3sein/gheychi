<!-- apps/provider-panel/src/components/ui/ConfirmSheet.vue -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useConfirm } from '@/composables/useConfirm'
import AppButton from './AppButton.vue'

// The single host for useConfirm(): a bottom sheet below 640px, a centred dialog from sm up.
const { pending, settle } = useConfirm()

const panel = ref<HTMLElement | null>(null)
const cancelButton = ref<InstanceType<typeof AppButton> | null>(null)
const confirmButton = ref<InstanceType<typeof AppButton> | null>(null)
const uid = Math.random().toString(36).slice(2, 8)
const titleId = `confirm-title-${uid}`
const messageId = `confirm-message-${uid}`

const options = computed(() => pending.value?.options)
const danger = computed(() => options.value?.tone === 'danger')

let returnFocusTo: HTMLElement | null = null
let previousOverflow = ''

function focusables(): HTMLElement[] {
  return Array.from(panel.value?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])
}

function lockScroll() {
  previousOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
}
function unlockScroll() {
  document.body.style.overflow = previousOverflow
}

watch(
  () => pending.value,
  async (now, before) => {
    if (now && !before) {
      returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
      lockScroll()
      await nextTick()
      // A destructive prompt starts on "cancel" so a stray Enter/double-tap can't confirm it.
      const target = danger.value ? cancelButton.value : confirmButton.value
      ;(target?.$el as HTMLElement | undefined)?.focus()
    } else if (!now && before) {
      unlockScroll()
      returnFocusTo?.focus()
      returnFocusTo = null
    }
  },
)

onBeforeUnmount(() => {
  if (pending.value) {
    unlockScroll()
    settle(false)
  }
})

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    settle(false)
    return
  }
  if (e.key !== 'Tab') return
  const items = focusables()
  if (items.length === 0) return
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement
  if (e.shiftKey && (active === first || !panel.value?.contains(active))) {
    e.preventDefault()
    last.focus()
  } else if (!e.shiftKey && (active === last || !panel.value?.contains(active))) {
    e.preventDefault()
    first.focus()
  }
}
</script>

<template>
  <Transition name="confirm">
    <div
      v-if="pending && options"
      class="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-4"
      data-testid="confirm-root"
      @keydown="onKeydown"
    >
      <div class="confirm-backdrop absolute inset-0 bg-black/50" data-testid="confirm-backdrop" @click="settle(false)" />
      <div
        ref="panel"
        role="alertdialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        :aria-describedby="options.message ? messageId : undefined"
        class="confirm-panel relative w-full rounded-t-2xl border border-(--color-border) bg-(--color-surface-card) px-5 pt-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-(--shadow-lg) sm:max-w-md sm:rounded-2xl sm:pb-5"
      >
        <h2 :id="titleId" class="text-base font-bold text-(--color-text)">{{ options.title }}</h2>
        <p v-if="options.message" :id="messageId" class="mt-2 whitespace-pre-line text-sm leading-6 text-(--color-text-muted)">
          {{ options.message }}
        </p>
        <div class="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <AppButton
            ref="confirmButton"
            :variant="danger ? 'danger' : 'primary'"
            data-testid="confirm-accept"
            @click="settle(true)"
          >
            {{ options.confirmLabel ?? 'تأیید' }}
          </AppButton>
          <AppButton ref="cancelButton" variant="secondary" data-testid="confirm-cancel" @click="settle(false)">
            {{ options.cancelLabel ?? 'انصراف' }}
          </AppButton>
        </div>
      </div>
    </div>
  </Transition>
</template>
