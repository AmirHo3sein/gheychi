<!-- apps/provider-panel/src/components/layout/ToastContainer.vue -->
<!-- One polite live region for the whole stack; an error toast additionally announces
     itself assertively through its own role="alert". pointer-events-none on the wrapper
     so the gaps never swallow taps meant for the page underneath. -->
<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { useToast } from '@/composables/useToast'

const { toasts, dismiss } = useToast()

const TONE_CLASSES = {
  success: 'bg-(--tone-success-bg) text-(--tone-success-text) border-(--tone-success-text)/30',
  error: 'bg-(--tone-danger-bg) text-(--tone-danger-text) border-(--tone-danger-text)/40',
  info: 'bg-(--color-text) text-(--color-surface) border-transparent',
} as const
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4" role="status" aria-live="polite">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      data-testid="toast"
      :data-tone="toast.tone"
      :role="toast.tone === 'error' ? 'alert' : undefined"
      class="pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl border py-3 ps-4 pe-2 text-sm shadow-(--shadow-lg)"
      :class="TONE_CLASSES[toast.tone]"
    >
      <AppIcon v-if="toast.tone === 'error'" name="warning" :size="18" class="mt-0.5 shrink-0" />
      <AppIcon v-else-if="toast.tone === 'success'" name="check" :size="18" class="mt-0.5 shrink-0" />
      <p class="min-w-0 flex-1 py-1">{{ toast.message }}</p>
      <button
        type="button"
        aria-label="بستن"
        data-testid="toast-dismiss"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg opacity-80 transition-opacity hover:opacity-100"
        @click="dismiss(toast.id)"
      >
        <AppIcon name="x" :size="16" />
      </button>
    </div>
  </div>
</template>
