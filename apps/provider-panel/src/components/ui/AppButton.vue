<script setup lang="ts">
import AppIcon from './AppIcon.vue'

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'sm' | 'md' | 'lg'
    loading?: boolean
    disabled?: boolean
    type?: 'button' | 'submit'
    block?: boolean
  }>(),
  { variant: 'primary', size: 'md', loading: false, disabled: false, type: 'button', block: false },
)
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || disabled"
    class="inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
    :class="[
      block ? 'w-full' : '',
      // sm intentionally drops below the 44px touch-target min the other two sizes keep --
      // only used for a row of several compact secondary actions (e.g. a booking card's
      // status buttons) where 44px each would dominate the card; never the sole/primary
      // action on a screen.
      size === 'lg' ? 'min-h-11 px-5 py-3.5 text-base' : size === 'sm' ? 'min-h-9 px-3 py-1.5 text-xs' : 'min-h-11 px-4 py-2.5 text-sm',
      variant === 'primary' && 'bg-(--color-accent-strong) text-(--color-fill-text) shadow-(--shadow-sm) hover:bg-(--color-accent-deep) hover:shadow-(--shadow-md) active:bg-(--color-accent-pressed)',
      variant === 'secondary' && 'border border-(--color-border) bg-(--color-border-soft) text-(--color-text) hover:bg-(--color-border)',
      variant === 'ghost' && 'bg-transparent text-(--color-text-muted) hover:bg-(--color-border-soft) hover:text-(--color-text)',
      variant === 'danger' && 'bg-(--color-danger-strong) text-(--color-fill-text) hover:opacity-90',
    ]"
  >
    <AppIcon v-if="loading" name="spinner" :size="size === 'lg' ? 20 : size === 'sm' ? 13 : 16" class="animate-spin" />
    <slot v-else name="icon" />
    <slot />
  </button>
</template>
