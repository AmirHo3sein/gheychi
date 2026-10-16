<!-- apps/admin-panel/src/components/ui/AppSwitch.vue -->
<!-- The one on/off switch (feature flags, referral reward types). Brand colours rather than the
     old dark-rust track:
       on  -- peach track (--color-accent) with a charcoal knob (--color-fill-text, 8.83:1 on
              peach) and a terracotta outline (--color-accent-text, 5.79:1 against the white
              card), so the track edge itself clears WCAG 1.4.11's 3:1;
       off -- blush track with the control-border outline (3.74:1) and a muted knob.
     State is carried by knob position AND knob colour AND the track fill, never one cue alone,
     and the knob colours stay the same in dark mode because the peach fill does too.
     Attributes (data-testid, aria-label, disabled) fall through to the <button>. -->
<script setup lang="ts">
defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent-text) disabled:cursor-not-allowed disabled:opacity-60"
    @click="emit('update:modelValue', !modelValue)"
  >
    <span
      class="relative h-6 w-11 rounded-full border transition-colors duration-150"
      :class="modelValue ? 'border-(--color-accent-text) bg-(--color-accent)' : 'border-(--color-border-control) bg-(--color-surface-subtle)'"
    >
      <span
        class="absolute top-[3px] h-4 w-4 rounded-full shadow-(--shadow-sm) transition-all duration-150"
        :class="modelValue ? 'end-[3px] bg-(--color-fill-text)' : 'start-[3px] bg-(--color-border-control)'"
      />
    </span>
  </button>
</template>
