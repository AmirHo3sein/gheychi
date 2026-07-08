<!-- apps/admin-panel/src/pages/ConfigView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'

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
  <div class="max-w-md space-y-4 p-6">
    <h1 class="text-lg font-bold">تنظیمات پلتفرم</h1>

    <div v-for="row in rows" :key="row.key" class="flex items-center justify-between gap-3">
      <label class="text-sm">{{ row.key }}</label>
      <input v-model.number="row.value" type="number" class="w-32 rounded-lg border p-2 text-sm" />
    </div>

    <button
      type="button"
      :disabled="saving"
      class="rounded-lg bg-(--color-accent) px-4 py-2 text-sm text-white"
      @click="save"
    >
      ذخیره
    </button>
  </div>
</template>
