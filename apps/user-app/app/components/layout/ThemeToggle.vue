<script setup lang="ts">
import type { IconName } from '~/components/ui/BaseIcon.vue'

const { preference, setPreference, apply } = useTheme()

const options: { value: 'light' | 'dark' | 'system'; icon: IconName; label: string }[] = [
  { value: 'light', icon: 'sun', label: 'روشن' },
  { value: 'dark', icon: 'moon', label: 'تاریک' },
  { value: 'system', icon: 'monitor', label: 'سیستم' },
]

// Re-sync the .dark class against the current cookie on mount: the inline anti-flash
// script only runs once at initial page load, so if the theme cookie changed since then
// (e.g. set in another tab) this catches the drift without requiring a reload.
onMounted(() => apply())
</script>

<template>
  <div class="flex gap-1 rounded-full border border-(--color-border) bg-(--color-surface-card) p-1" role="radiogroup" aria-label="حالت نمایش">
    <button
      v-for="opt in options"
      :key="opt.value"
      type="button"
      role="radio"
      :aria-checked="preference === opt.value"
      :aria-label="opt.label"
      class="flex h-8 w-8 items-center justify-center rounded-full transition-colors"
      :class="preference === opt.value ? 'bg-(--color-accent-strong) text-white' : 'text-(--color-text-muted) hover:bg-(--color-surface-subtle) hover:text-(--color-text)'"
      @click="setPreference(opt.value)"
    >
      <BaseIcon :name="opt.icon" :size="16" />
    </button>
  </div>
</template>
