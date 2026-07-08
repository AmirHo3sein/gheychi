<!-- apps/admin-panel/src/pages/SalonsView.vue -->
<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useApi } from '@/composables/useApi'

interface SalonRow {
  id: string
  name: string
  city: string
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  genderTarget: 'women' | 'men'
  isFeatured: boolean
  createdAt: string
}

const { apiFetch } = useApi()
const salons = ref<SalonRow[]>([])
const loading = ref(true)

const statusFilter = ref<'pending' | 'approved' | 'rejected' | 'suspended'>('pending')
const cityFilter = ref('')
const nameFilter = ref('')
const genderFilter = ref<'' | 'women' | 'men'>('')

async function load() {
  loading.value = true
  const params = new URLSearchParams({ status: statusFilter.value })
  if (cityFilter.value) params.set('city', cityFilter.value)
  if (nameFilter.value) params.set('name', nameFilter.value)
  if (genderFilter.value) params.set('genderTarget', genderFilter.value)

  const { data } = await apiFetch<SalonRow[]>(`/admin/salons?${params.toString()}`, { silent: true })
  salons.value = data ?? []
  loading.value = false
}

onMounted(load)
watch([statusFilter, cityFilter, nameFilter, genderFilter], load)
</script>

<template>
  <div class="space-y-4 p-6">
    <h1 class="text-lg font-bold">آرایشگاه‌ها</h1>

    <div class="flex flex-wrap gap-3">
      <select v-model="statusFilter" data-testid="status-filter" class="rounded-lg border p-2 text-sm">
        <option value="pending">در انتظار بررسی</option>
        <option value="approved">تایید شده</option>
        <option value="rejected">رد شده</option>
        <option value="suspended">معلق</option>
      </select>
      <input v-model="cityFilter" placeholder="شهر" class="rounded-lg border p-2 text-sm" />
      <input v-model="nameFilter" placeholder="نام آرایشگاه" class="rounded-lg border p-2 text-sm" />
      <select v-model="genderFilter" class="rounded-lg border p-2 text-sm">
        <option value="">همه</option>
        <option value="women">بانوان</option>
        <option value="men">آقایان</option>
      </select>
    </div>

    <p v-if="!loading && salons.length === 0" class="text-sm text-gray-500">موردی یافت نشد.</p>

    <table v-else class="w-full text-right text-sm">
      <thead>
        <tr class="border-b text-gray-500">
          <th class="p-2">نام</th>
          <th class="p-2">شهر</th>
          <th class="p-2">مخاطب</th>
          <th class="p-2">وضعیت</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="salon in salons" :key="salon.id" class="border-b">
          <td class="p-2">
            <RouterLink :to="`/salons/${salon.id}`" class="text-(--color-accent)">{{ salon.name }}</RouterLink>
          </td>
          <td class="p-2">{{ salon.city }}</td>
          <td class="p-2">{{ salon.genderTarget === 'women' ? 'بانوان' : 'آقایان' }}</td>
          <td class="p-2">{{ salon.status }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
