<!-- apps/admin-panel/src/components/ui/SortableTh.vue -->
<!-- A sortable column header: the <th> carries aria-sort, its content is a real button (so the
     column is keyboard-sortable), and the arrow shows the active direction. The page owns the
     sort state (normally URL-persisted through useQueryFilters) and re-queries the API --
     sorting is server-side, so it orders the whole result set, not just the visible page. -->
<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { ariaSort, nextSort, type SortOrder } from '@/utils/table-sort'

const props = withDefaults(
  defineProps<{
    label: string
    field: string
    sort: string
    order: SortOrder
    /** Direction of the first click on this column. */
    firstOrder?: SortOrder
  }>(),
  { firstOrder: 'asc' },
)
const emit = defineEmits<{ sort: [value: { sort: string; order: SortOrder }] }>()

const active = computed(() => props.sort === props.field)
const icon = computed(() => (!active.value ? 'sort' : props.order === 'asc' ? 'sort-asc' : 'sort-desc'))
const hint = computed(() => {
  if (!active.value) return 'مرتب‌سازی بر اساس این ستون'
  return props.order === 'asc' ? 'مرتب‌شده صعودی؛ برای نزولی کلیک کنید' : 'مرتب‌شده نزولی؛ برای صعودی کلیک کنید'
})

function click() {
  emit('sort', nextSort({ sort: props.sort, order: props.order }, props.field, props.firstOrder))
}
</script>

<template>
  <th scope="col" class="px-5 py-3 font-semibold" :aria-sort="ariaSort(active, order)">
    <button
      type="button"
      :data-testid="`sort-${field}`"
      :title="hint"
      class="-mx-1.5 inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 transition-colors duration-150 hover:bg-(--color-surface-subtle) hover:text-(--color-text)"
      :class="active ? 'text-(--color-text)' : ''"
      @click="click"
    >
      {{ label }}
      <AppIcon :name="icon" :size="13" :class="active ? '' : 'opacity-40'" />
    </button>
  </th>
</template>
