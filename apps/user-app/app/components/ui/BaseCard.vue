<script setup lang="ts">
withDefaults(defineProps<{ padding?: 'none' | 'md' | 'lg' }>(), { padding: 'md' })
</script>

<template>
  <div
    class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-sm)"
    :class="{ 'p-4': padding === 'md', 'p-6 sm:p-8': padding === 'lg' }"
  >
    <slot />
  </div>
</template>
