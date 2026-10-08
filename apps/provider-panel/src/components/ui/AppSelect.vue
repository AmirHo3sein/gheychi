<script setup lang="ts">
import { ref, useId } from 'vue'
import Multiselect from 'vue-multiselect'
import { useListboxReference } from '@/composables/useListboxReference'
import 'vue-multiselect/dist/vue-multiselect.css'

export interface SelectOption {
  value: string | number
  label: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string | number | null
    options: SelectOption[]
    placeholder?: string
    disabled?: boolean
    /**
     * Defaults to vue-multiselect's own `true`, which is right for the long lists this
     * wrapper was first built for (the 80+ city picker). Pass `false` for a short, fixed
     * list -- a search box above two options is noise, and it puts a text caret where the
     * user expects to just pick.
     */
    searchable?: boolean
    /** Override only when a caller needs a stable DOM id; otherwise a unique one is generated. */
    id?: string
  }>(),
  { placeholder: 'انتخاب کنید', disabled: false, searchable: true },
)

// vue-multiselect derives its listbox id (aria-controls/aria-owns) from `id`; without one it
// renders the literal "listbox-null", an invalid ARIA reference.
const generatedId = useId()
const select = ref<{ $el?: Element } | null>(null)
const { onOpen, onClose } = useListboxReference(select, () => props.id ?? generatedId)

const emit = defineEmits<{ 'update:modelValue': [value: string | number | null] }>()

function onSelect(option: SelectOption | null) {
  emit('update:modelValue', option ? option.value : null)
}
</script>

<template>
  <Multiselect
    ref="select"
    :id="props.id ?? generatedId"
    class="app-select"
    :model-value="props.options.find((o) => o.value === props.modelValue) ?? null"
    :options="props.options"
    label="label"
    track-by="value"
    :placeholder="props.placeholder"
    :disabled="props.disabled"
    :searchable="props.searchable"
    :allow-empty="false"
    :show-labels="false"
    @open="onOpen"
    @close="onClose"
    @update:model-value="onSelect"
  />
</template>
