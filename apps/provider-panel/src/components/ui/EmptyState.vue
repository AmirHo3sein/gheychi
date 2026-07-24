<script setup lang="ts">
import AppIcon, { type IconName } from '@/components/ui/AppIcon.vue'

withDefaults(defineProps<{ icon?: IconName; message: string }>(), { icon: 'store' })
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-(--color-border) py-14 text-center">
    <div class="flex h-12 w-12 items-center justify-center rounded-full bg-(--color-border-soft) text-(--color-text-muted)">
      <AppIcon :name="icon" :size="22" />
    </div>
    <p class="text-sm text-(--color-text-muted)">{{ message }}</p>
  </div>
</template>
