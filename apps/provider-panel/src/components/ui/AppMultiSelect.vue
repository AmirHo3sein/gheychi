<script setup lang="ts">
import { ref, useId } from 'vue'
import Multiselect from 'vue-multiselect'
import { useListboxReference } from '@/composables/useListboxReference'
import 'vue-multiselect/dist/vue-multiselect.css'
import type { SelectOption } from './AppSelect.vue'

// Sibling to AppSelect.vue, not a modification of it -- several single-select call
// sites depend on AppSelect's current single-value contract (allow-empty:false,
// emits one value). This is vue-multiselect's own `multiple` mode, unused anywhere
// else in this app until now.
const props = withDefaults(
  defineProps<{
    modelValue: Array<string | number>
    options: SelectOption[]
    placeholder?: string
    disabled?: boolean
    /** Override only when a caller needs a stable DOM id; otherwise a unique one is generated. */
    id?: string
  }>(),
  { placeholder: 'انتخاب کنید', disabled: false },
)

// See AppSelect.vue: a missing id makes vue-multiselect emit aria-controls="listbox-null".
const generatedId = useId()
const select = ref<{ $el?: Element } | null>(null)
const { onOpen, onClose } = useListboxReference(select, () => props.id ?? generatedId)

const emit = defineEmits<{ 'update:modelValue': [value: Array<string | number>] }>()

function onSelect(selected: SelectOption[]) {
  emit('update:modelValue', selected.map((o) => o.value))
}

function removeValue(option: SelectOption) {
  emit('update:modelValue', props.modelValue.filter((v) => v !== option.value))
}
</script>

<template>
  <Multiselect
    ref="select"
    :id="props.id ?? generatedId"
    class="app-select"
    :model-value="props.options.filter((o) => props.modelValue.includes(o.value))"
    :options="props.options"
    label="label"
    track-by="value"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    multiple
    :close-on-select="false"
    :show-labels="false"
    @open="onOpen"
    @close="onClose"
    @update:model-value="onSelect"
  >
    <!-- vue-multiselect's stock tag renders its remove icon as <i tabindex="1"> (a positive
         tabindex, and no name for assistive tech). Same markup/classes so styling is
         unchanged, but a real tab-order position, a button role and a Persian name. -->
    <template #tag="{ option }">
      <span class="multiselect__tag" @mousedown.prevent>
        <span>{{ option.label }}</span>
        <i
          tabindex="0"
          role="button"
          class="multiselect__tag-icon"
          :aria-label="`حذف ${option.label}`"
          @keydown.enter.prevent="removeValue(option)"
          @mousedown.prevent="removeValue(option)"
        ></i>
      </span>
    </template>
  </Multiselect>
</template>
