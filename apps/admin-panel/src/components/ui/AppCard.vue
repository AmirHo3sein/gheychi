<!-- apps/admin-panel/src/components/ui/AppCard.vue -->
<script setup lang="ts">
withDefaults(defineProps<{ padded?: boolean }>(), { padded: true })
</script>

<template>
  <div
    class="rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-sm)"
    :class="padded && 'p-5'"
  >
    <slot />
  </div>
</template>
