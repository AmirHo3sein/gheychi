<!-- apps/user-app/app/components/beauty-guide/GuideConceptList.vue
     "What we detected": each AI concept as a card with hedged confidence wording, plus the
     customer's corrections (not this / bring back / yes, this one / I meant something
     else). The customer's choices are authoritative -- the parent persists them via PATCH. -->
<script setup lang="ts">
import { conceptLabel, confidenceLabel, isDrivingMatch, type GuideConcept } from '../../utils/beauty-guide'

const props = defineProps<{
  concepts: GuideConcept[]
  vocabulary: Array<{ key: string; nameFa: string; nameEn: string; domain: string }>
  domain: string | null
  busy?: boolean
}>()
const emit = defineEmits<{
  remove: [key: string]
  restore: [key: string]
  confirm: [key: string]
  add: [key: string]
}>()

const active = computed(() => props.concepts.filter((c) => !c.removed))
const removed = computed(() => props.concepts.filter((c) => c.removed))
const pickerOpen = ref(false)
const pickerValue = ref('')
// Offer same-domain alternatives first; never offer something already on the guide.
const options = computed(() => {
  const taken = new Set(props.concepts.filter((c) => !c.removed).map((c) => c.key))
  return props.vocabulary
    .filter((v) => !taken.has(v.key))
    .sort((a, b) => Number(b.domain === props.domain) - Number(a.domain === props.domain))
})

function submitPicker() {
  if (!pickerValue.value) return
  emit('add', pickerValue.value)
  pickerValue.value = ''
  pickerOpen.value = false
}
</script>

<template>
  <section class="space-y-3" aria-labelledby="guide-concepts-title">
    <div class="flex items-center gap-2">
      <BaseIcon name="sparkles" :size="18" class="text-(--color-ai)" />
      <h2 id="guide-concepts-title" class="font-bold text-(--color-text)">چه چیزی تشخیص دادیم</h2>
    </div>

    <p v-if="!active.length" data-testid="concepts-empty" class="text-sm text-(--color-text-muted)">
      مورد مشخصی تشخیص داده نشد. می‌توانید خودتان انتخاب کنید.
    </p>

    <ul class="grid gap-2 sm:grid-cols-2">
      <li
        v-for="concept in active"
        :key="concept.key"
        :data-testid="`concept-${concept.key}`"
        class="rounded-2xl border bg-(--color-surface-card) p-3 shadow-(--shadow-sm)"
        :class="isDrivingMatch(concept) ? 'border-(--color-border)' : 'border-dashed border-(--color-border)'"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <p class="text-xs font-semibold text-(--color-ai)" data-testid="concept-confidence">{{ confidenceLabel(concept) }}</p>
            <p class="break-words font-bold text-(--color-text)">{{ conceptLabel(concept) }}</p>
          </div>
          <button
            type="button"
            class="shrink-0 rounded-full px-2 py-1 text-xs text-(--color-text-muted) hover:bg-(--color-surface-subtle)"
            :disabled="busy"
            :aria-label="`حذف ${concept.nameFa}`"
            data-testid="concept-remove"
            @click="emit('remove', concept.key)"
          >
            این نیست
          </button>
        </div>
        <p v-if="concept.evidenceFa" class="mt-1 text-xs text-(--color-text-muted)">{{ concept.evidenceFa }}</p>
        <!-- A low-confidence guess is a suggestion only: it doesn't affect salon matching
             until the customer says it's right. -->
        <div v-if="!isDrivingMatch(concept)" class="mt-2 flex items-center justify-between gap-2 text-xs">
          <span class="text-(--color-text-muted)">در جستجوی سالن لحاظ نمی‌شود</span>
          <button
            type="button"
            class="rounded-full bg-(--color-accent-soft) px-3 py-1 font-semibold text-(--color-accent-text)"
            :disabled="busy"
            data-testid="concept-confirm"
            @click="emit('confirm', concept.key)"
          >
            بله، همین است
          </button>
        </div>
        <p v-else-if="!concept.mappable" class="mt-2 text-xs text-(--color-text-muted)">فعلاً خدمت مرتبطی برای آن ثبت نشده است.</p>
      </li>
    </ul>

    <div v-if="removed.length" class="flex flex-wrap items-center gap-2 text-xs">
      <span class="text-(--color-text-muted)">حذف‌شده:</span>
      <button
        v-for="concept in removed"
        :key="concept.key"
        type="button"
        class="rounded-full border border-(--color-border) px-3 py-1 text-(--color-text-muted) line-through hover:no-underline"
        :disabled="busy"
        :data-testid="`concept-restore-${concept.key}`"
        @click="emit('restore', concept.key)"
      >
        {{ concept.nameFa }}
      </button>
    </div>

    <div>
      <button
        v-if="!pickerOpen"
        type="button"
        class="text-sm font-medium text-(--color-accent-text) hover:underline"
        data-testid="concept-add-open"
        @click="pickerOpen = true"
      >
        منظورم چیز دیگری بود…
      </button>
      <form v-else class="flex flex-wrap items-center gap-2" @submit.prevent="submitPicker">
        <label class="sr-only" for="guide-concept-picker">انتخاب مورد</label>
        <select
          id="guide-concept-picker"
          v-model="pickerValue"
          data-testid="concept-add-select"
          class="min-h-11 flex-1 rounded-xl border border-(--color-border) bg-(--color-surface-card) px-3 text-sm text-(--color-text)"
        >
          <option value="" disabled>یک مورد انتخاب کنید</option>
          <option v-for="option in options" :key="option.key" :value="option.key">{{ conceptLabel(option) }}</option>
        </select>
        <BaseButton type="submit" :disabled="!pickerValue || busy" data-testid="concept-add-submit">افزودن</BaseButton>
        <BaseButton type="button" variant="ghost" @click="pickerOpen = false">انصراف</BaseButton>
      </form>
    </div>
  </section>
</template>
