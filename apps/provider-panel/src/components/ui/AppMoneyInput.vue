<!-- apps/provider-panel/src/components/ui/AppMoneyInput.vue -->
<!-- A toman amount field that displays comma-grouped digits ("3,000,000") live, while typing
     -- not just once the field blurs. The classic failure mode of "format as you type" is the
     caret jumping mid-edit as commas are inserted/removed around it; this avoids that by doing
     the caret math itself instead of trusting the browser to guess: on every keystroke, count
     how many DIGITS sit before the caret in the old value, reformat, then walk the new
     (grouped) string forward the same number of digits and place the caret right after that --
     a comma inserted or removed to the caret's right never moves it, only ones genuinely to its
     left do, which is what a typing user actually expects. v-model stays a clean digit-only
     string throughout -- callers that parse it with Number(...) need no changes. -->
<script setup lang="ts">
import { nextTick } from 'vue'
import AppInput from './AppInput.vue'
import { formatToman } from '@/utils/format-toman'
import { toEnglishDigits } from '@/utils/digits'

defineProps<{ label?: string; error?: string; disabled?: boolean }>()
const model = defineModel<string>({ default: '' })

function displayValue(raw: string): string {
  if (raw === '') return ''
  const n = Number(raw)
  return Number.isFinite(n) ? formatToman(n) : raw
}

function digitsBefore(str: string, index: number): number {
  let count = 0
  for (let i = 0; i < index && i < str.length; i++) {
    if (str[i]! >= '0' && str[i]! <= '9') count++
  }
  return count
}

// Inverse of digitsBefore: the caret position immediately after the Nth digit in `str` (so a
// digitsBefore() count of 0 stays before any leading "-", matching where a caret already at
// the very start of the old value belongs).
function caretAfterDigitCount(str: string, digitCount: number): number {
  if (digitCount <= 0) return 0
  let seen = 0
  for (let i = 0; i < str.length; i++) {
    if (str[i]! >= '0' && str[i]! <= '9') {
      seen++
      if (seen === digitCount) return i + 1
    }
  }
  return str.length
}

function onInput(event: Event) {
  const el = event.target as HTMLInputElement
  const raw = el.value
  const caret = el.selectionStart ?? raw.length
  // digitsBefore/caretAfterDigitCount only recognize ASCII '0'-'9' -- formatToman (and thus
  // displayValue below) now renders Farsi digits, so both the just-typed raw value and the
  // freshly reformatted one are normalized to ASCII first. toEnglishDigits is a 1:1 character
  // substitution (no length change), so `caret`'s numeric offset stays valid against the
  // normalized string.
  const targetDigitCount = digitsBefore(toEnglishDigits(raw), caret)

  // toEnglishDigits first: Iranian keyboards/IMEs commonly default to Persian numerals, and
  // stripping non-ASCII-digit characters without normalizing first would silently delete a
  // Persian-digit price instead of reading it -- the exact bug this field replaces a native
  // type="number" input specifically to avoid (see updatePrice()'s own comment in
  // ServicesView.vue). A pasted "3,000,000" or a stray non-digit keystroke both still collapse
  // to the clean digit string this field's v-model promises callers.
  //
  // A leading "-" survives on purpose: this field doesn't decide whether negative amounts are
  // valid, the caller's own Number(...) validation does (a price <= 0 check, an adjustment
  // that can legitimately subtract). Silently dropping the sign would turn an obviously-invalid
  // "-5" into a quietly-accepted "5" instead of letting that check reject it as intended.
  const digitsAndSign = toEnglishDigits(raw).replace(/[^\d-]/g, '')
  const negative = digitsAndSign.startsWith('-')
  model.value = (negative ? '-' : '') + digitsAndSign.replace(/-/g, '')

  // Vue hasn't re-rendered yet at this point in the native input handler -- wait for the
  // reformatted value to actually land in the DOM before placing the caret, or the browser's
  // own post-input caret placement would just be overwritten by the re-render right after.
  nextTick(() => {
    const formatted = displayValue(model.value)
    const newCaret = caretAfterDigitCount(toEnglishDigits(formatted), targetDigitCount)
    el.setSelectionRange(newCaret, newCaret)
  })
}
</script>

<template>
  <!-- @update:model-value is a required no-op, not decoration: without SOME listener here,
       Vue's defineModel (inside AppInput) falls back to treating its own internal value as
       locally-owned rather than parent-controlled, and stops re-syncing to :model-value pushed
       down from here after the user's first keystroke -- silently breaking every external
       reset (a rejected price restoring the old value, a parent clearing the field after
       submit). @input carries this component's own actual logic; AppInput's native
       'input'-driven v-model still fires too, but harmlessly, since nothing here reads it. -->
  <AppInput
    :model-value="displayValue(model)"
    type="text"
    inputmode="numeric"
    dir="ltr"
    :label="label"
    :error="error"
    :disabled="disabled"
    @update:model-value="() => {}"
    @input="onInput"
  />
</template>
