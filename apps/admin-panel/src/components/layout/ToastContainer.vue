<!-- apps/admin-panel/src/components/layout/ToastContainer.vue -->
<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { useToast, type ToastTone } from '@/composables/useToast'

const { toasts, dismiss } = useToast()

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'bg-(--color-text) text-(--color-surface)',
  success: 'bg-(--tone-success-bg) text-(--tone-success-text) border border-(--tone-success-text)/30',
  error: 'bg-(--tone-danger-bg) text-(--tone-danger-text) border border-(--tone-danger-text)/30',
}
</script>

<template>
  <!-- The container is the polite live region (success/info); an error toast additionally
       carries role="alert" so it is announced assertively instead of waiting its turn. -->
  <div class="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      data-testid="toast"
      :data-tone="toast.tone"
      :role="toast.tone === 'error' ? 'alert' : 'status'"
      class="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl py-3 ps-4 pe-2 text-sm shadow-(--shadow-lg)"
      :class="TONE_CLASS[toast.tone]"
    >
      <AppIcon v-if="toast.tone === 'error'" name="warning" :size="18" class="mt-0.5 shrink-0" />
      <AppIcon v-else-if="toast.tone === 'success'" name="check" :size="18" class="mt-0.5 shrink-0" />
      <span class="min-w-0 flex-1 break-words leading-6">{{ toast.message }}</span>
      <button
        type="button"
        data-testid="toast-dismiss"
        aria-label="بستن"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg opacity-80 transition-opacity hover:opacity-100"
        @click="dismiss(toast.id)"
      >
        <AppIcon name="x" :size="16" />
      </button>
    </div>
  </div>
</template>
