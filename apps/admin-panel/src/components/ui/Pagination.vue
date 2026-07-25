<!-- apps/admin-panel/src/components/ui/Pagination.vue -->
<script setup lang="ts">
import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ page: number; pageSize: number; total: number }>()
const emit = defineEmits<{ 'update:page': [page: number] }>()

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const rangeStart = computed(() => (props.total === 0 ? 0 : (props.page - 1) * props.pageSize + 1))
const rangeEnd = computed(() => Math.min(props.page * props.pageSize, props.total))

function go(page: number) {
  if (page < 1 || page > totalPages.value) return
  emit('update:page', page)
}
</script>

<template>
  <div v-if="total > 0" class="flex items-center justify-between border-t border-(--color-border-soft) px-5 py-3">
    <p class="tnum text-xs text-(--color-text-muted)">{{ rangeStart }}–{{ rangeEnd }} از {{ total }}</p>
    <div class="flex items-center gap-1">
      <button
        type="button"
        :disabled="page <= 1"
        aria-label="صفحه قبل"
        class="flex h-11 w-11 items-center justify-center rounded-lg text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text) disabled:pointer-events-none disabled:opacity-30"
        @click="go(page - 1)"
      >
        <AppIcon name="chevron-right" :size="15" />
      </button>
      <span class="tnum px-2 text-xs font-semibold text-(--color-text)">صفحه {{ page }} از {{ totalPages }}</span>
      <button
        type="button"
        :disabled="page >= totalPages"
        aria-label="صفحه بعد"
        class="flex h-11 w-11 items-center justify-center rounded-lg text-(--color-text-muted) transition-colors hover:bg-(--color-border-soft) hover:text-(--color-text) disabled:pointer-events-none disabled:opacity-30"
        @click="go(page + 1)"
      >
        <AppIcon name="chevron-left" :size="15" />
      </button>
    </div>
  </div>
</template>
