<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
</script>

<template>
  <div class="flex min-h-screen flex-col items-center justify-center gap-4 bg-(--color-surface) p-6 text-center">
    <div class="flex h-16 w-16 items-center justify-center rounded-2xl bg-(--tone-danger-bg) text-(--tone-danger-text)">
      <AppIcon name="lock" :size="28" />
    </div>
    <div>
      <h1 class="text-lg font-bold text-(--color-text)">دسترسی غیرمجاز</h1>
      <p class="mt-1 max-w-xs text-sm text-(--color-muted)">این بخش فقط برای مدیران سیستم قابل دسترسی است.</p>
    </div>
  </div>
</template>
