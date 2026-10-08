<script setup lang="ts">
const { toasts, dismiss } = useToast()
</script>

<template>
  <!-- Sits above the phone tab bar (3.5rem + safe area) so a toast never lands on top of it,
       and bottom-4 from `md` up where there is no bar. Errors are announced assertively,
       everything else politely, via two separate live regions (a single region can't carry
       two politeness levels). -->
  <div
    class="pointer-events-none fixed inset-x-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex flex-col items-center gap-2 md:bottom-4"
  >
    <div role="status" aria-live="polite" class="flex w-full flex-col items-center gap-2">
      <template v-for="toast in toasts" :key="toast.id">
        <div
          v-if="toast.tone !== 'error'"
          data-testid="toast"
          class="pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl bg-(--color-surface-card) py-2.5 ps-4 pe-2 text-sm text-(--color-text) shadow-(--shadow-lg)"
        >
          <BaseIcon v-if="toast.tone === 'success'" name="check-circle" :size="18" class="mt-0.5 text-(--color-success)" />
          <span class="min-w-0 flex-1 break-words py-1">{{ toast.message }}</span>
          <button type="button" aria-label="بستن" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-(--color-text-muted) hover:bg-(--color-surface-subtle)" @click="dismiss(toast.id)">
            <BaseIcon name="x" :size="16" />
          </button>
        </div>
      </template>
    </div>
    <div role="alert" class="flex w-full flex-col items-center gap-2">
      <template v-for="toast in toasts" :key="toast.id">
        <div
          v-if="toast.tone === 'error'"
          data-testid="toast"
          class="pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded-xl border border-(--color-danger) bg-(--color-surface-card) py-2.5 ps-4 pe-2 text-sm text-(--color-text) shadow-(--shadow-lg)"
        >
          <BaseIcon name="alert-circle" :size="18" class="mt-0.5 text-(--color-danger)" />
          <span class="min-w-0 flex-1 break-words py-1">{{ toast.message }}</span>
          <button type="button" aria-label="بستن" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-(--color-text-muted) hover:bg-(--color-surface-subtle)" @click="dismiss(toast.id)">
            <BaseIcon name="x" :size="16" />
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
