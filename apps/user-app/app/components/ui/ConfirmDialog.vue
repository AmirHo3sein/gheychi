<script setup lang="ts">
import { lockBodyScroll } from '../../utils/scroll-lock'

// The app's one generic "are you sure?" dialog, replacing native confirm() (unstyled, not
// translatable, blocks the main thread, and can't explain what will happen). Mount it with
// `v-if` at the call site, exactly like ReportForm: it focuses its first control on mount
// (the dismiss button -- the safe default for a destructive prompt), traps Tab, closes on
// Escape and restores focus when it unmounts (all via useDialog).
//
// Presentation: a bottom sheet under 640px (thumb-reachable), centered above. The body is
// the default slot so callers can explain consequences (e.g. refund vs forfeited deposit);
// `message` is the shorthand for a plain sentence.
const props = withDefaults(
  defineProps<{
    title: string
    message?: string
    confirmLabel?: string
    cancelLabel?: string
    tone?: 'danger' | 'default'
    /** Confirm in flight: the confirm button spins and every way out of the dialog is blocked. */
    loading?: boolean
    confirmTestId?: string
    cancelTestId?: string
  }>(),
  { confirmLabel: 'تایید', cancelLabel: 'انصراف', tone: 'danger', loading: false },
)
const emit = defineEmits<{ confirm: []; cancel: [] }>()

// Extra attributes (data-testid, ...) belong on the dialog panel, not the full-screen overlay.
defineOptions({ inheritAttrs: false })

function dismiss() {
  if (props.loading) return
  emit('cancel')
}

const dialogRoot = ref<HTMLElement | null>(null)
// The cast works around a vue-tsc/vue 3.5.42 template-ref inference mismatch (see
// useDialog.ts's own signature) -- dialogRoot really is Ref<HTMLElement | null> at runtime.
const { titleId } = useDialog(dialogRoot as unknown as Ref<HTMLElement | null>, { onClose: dismiss })
const descriptionId = useId()

let unlockScroll: (() => void) | null = null
onMounted(() => {
  unlockScroll = lockBodyScroll()
})
onBeforeUnmount(() => unlockScroll?.())
</script>

<template>
  <!-- items-end on phones / items-center from sm: -- a sheet anchored to the bottom edge is
       reachable one-handed; overflow-y-auto + my-auto-style centering keeps a tall body
       scrollable in landscape instead of pushing its top out of reach. -->
  <div class="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto overscroll-contain bg-black/40 sm:items-center sm:p-4">
    <div
      v-bind="$attrs"
      ref="dialogRoot"
      role="alertdialog"
      aria-modal="true"
      :aria-labelledby="titleId"
      :aria-describedby="descriptionId"
      tabindex="-1"
      class="w-full space-y-3 rounded-t-2xl border border-(--color-border) bg-(--color-surface-card) p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-(--shadow-lg) outline-none sm:max-w-sm sm:rounded-2xl sm:pb-6"
    >
      <h2 :id="titleId" class="text-lg font-bold text-(--color-text)">{{ title }}</h2>
      <div :id="descriptionId" class="space-y-2 text-sm text-(--color-text-muted)">
        <slot>
          <p v-if="message">{{ message }}</p>
        </slot>
      </div>
      <div class="flex gap-2 pt-1">
        <BaseButton variant="secondary" block :data-testid="cancelTestId" :disabled="loading" @click="dismiss">
          {{ cancelLabel }}
        </BaseButton>
        <BaseButton
          :variant="tone === 'danger' ? 'danger' : 'primary'"
          block
          :data-testid="confirmTestId"
          :loading="loading"
          @click="emit('confirm')"
        >
          {{ confirmLabel }}
        </BaseButton>
      </div>
    </div>
  </div>
</template>
