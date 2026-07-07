<!-- apps/provider-panel/src/components/layout/ToastContainer.vue -->
<script setup lang="ts">
import { useToast } from '@/composables/useToast'

const { toasts } = useToast()
</script>

<template>
  <div class="fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      data-testid="toast"
      class="w-full max-w-sm rounded-lg bg-(--color-text) px-4 py-3 text-sm text-white shadow-lg"
    >
      {{ toast.message }}
    </div>
  </div>
</template>
