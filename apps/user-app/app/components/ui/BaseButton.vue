<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
    size?: 'md' | 'lg'
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
    class="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100"
    :class="[
      block ? 'w-full' : '',
      size === 'lg' ? 'px-5 py-3.5 text-base' : 'px-4 py-2.5 text-sm',
      variant === 'primary' && 'bg-(--color-accent-strong) text-(--color-fill-text) shadow-(--shadow-sm) hover:bg-(--color-accent-deep) hover:shadow-(--shadow-md) active:bg-(--color-accent-pressed)',
      variant === 'secondary' && 'border border-(--color-border) bg-(--color-surface-subtle) text-(--color-text) hover:bg-(--color-border)',
      variant === 'ghost' && 'bg-transparent text-(--color-text-muted) hover:bg-(--color-surface-subtle) hover:text-(--color-text)',
      variant === 'danger' && 'bg-(--color-danger-strong) text-(--color-fill-text) hover:opacity-90',
    ]"
  >
    <BaseIcon v-if="loading" name="spinner" :size="size === 'lg' ? 20 : 16" class="animate-spin" />
    <slot v-else name="icon" />
    <slot />
  </button>
</template>
