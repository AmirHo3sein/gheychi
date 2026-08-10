<script setup lang="ts">
const { toasts } = useToast()
</script>

<template>
  <div class="fixed bottom-4 inset-x-4 z-50 flex flex-col gap-2 items-center" role="status" aria-live="polite">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      data-testid="toast"
      class="bg-(--color-surface-card) text-(--color-text) shadow-(--shadow-lg) rounded-xl px-4 py-3 text-sm max-w-sm"
    >
      {{ toast.message }}
    </div>
  </div>
</template>
