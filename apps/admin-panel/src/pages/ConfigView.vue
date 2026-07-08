<!-- apps/admin-panel/src/pages/ConfigView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppCard from '@/components/ui/AppCard.vue'
import { configKeyMeta } from '@/utils/labels'

interface ConfigRow {
  key: string
  value: number
}

const { apiFetch } = useApi()
const { push: pushToast } = useToast()
const rows = ref<ConfigRow[]>([])
const saving = ref(false)

async function load() {
  const { data } = await apiFetch<ConfigRow[]>('/admin/config', { silent: true })
  rows.value = data ?? []
}

async function save() {
  saving.value = true
  const { error } = await apiFetch('/admin/config', {
    method: 'PATCH',
    body: { updates: rows.value.map((r) => ({ key: r.key, value: r.value })) },
  })
  if (!error) pushToast('تغییرات ذخیره شد')
  saving.value = false
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-2xl space-y-5 p-8">
    <AppCard :padded="false">
      <div v-for="(row, i) in rows" :key="row.key" class="flex items-center justify-between gap-4 px-5 py-4" :class="i > 0 && 'border-t border-(--color-border-soft)'">
        <div>
          <p class="text-sm font-semibold text-(--color-text)">{{ configKeyMeta(row.key).label }}</p>
          <p v-if="configKeyMeta(row.key).hint" class="mt-0.5 text-xs text-(--color-muted)">{{ configKeyMeta(row.key).hint }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <input v-model.number="row.value" type="number" class="tnum w-24 rounded-xl border border-(--color-border) p-2 text-left text-sm" />
          <span v-if="configKeyMeta(row.key).unit" class="w-14 text-xs text-(--color-muted)">{{ configKeyMeta(row.key).unit }}</span>
        </div>
      </div>
    </AppCard>

    <button
      type="button"
      :disabled="saving"
      class="rounded-xl bg-(--color-accent) px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      @click="save"
    >
      ذخیره تغییرات
    </button>
  </div>
</template>
