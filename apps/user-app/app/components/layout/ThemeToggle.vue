<script setup lang="ts">
const { isDark, toggle, apply } = useTheme()

// Re-sync the .dark class against the current cookie on mount: the inline anti-flash
// script only runs once at initial page load, so if the theme cookie changed since then
// (e.g. set in another tab) this catches the drift without requiring a reload.
onMounted(() => apply())
</script>

<template>
  <button
    type="button"
    :title="isDark ? 'حالت روشن' : 'حالت تیره'"
    class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-(--color-text-muted) transition-all duration-200 hover:bg-(--color-surface-subtle) hover:text-(--color-text) active:scale-90"
    @click="toggle"
  >
    <BaseIcon :name="isDark ? 'sun' : 'moon'" :size="18" />
  </button>
</template>
