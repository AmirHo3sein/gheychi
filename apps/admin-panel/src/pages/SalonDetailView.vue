<!-- apps/admin-panel/src/pages/SalonDetailView.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useApi } from '@/composables/useApi'
import SalonStatusActions from '@/components/salons/SalonStatusActions.vue'

interface SalonDetail {
  id: string
  name: string
  description: string | null
  status: 'pending' | 'approved' | 'rejected' | 'suspended'
  genderTarget: 'women' | 'men'
  address: string
  city: string
  capacity: number
  rejectionReason: string | null
}

const route = useRoute()
const { apiFetch } = useApi()
const salon = ref<SalonDetail | null>(null)
const notFound = ref(false)

async function load() {
  const { data, error } = await apiFetch<SalonDetail>(`/admin/salons/${route.params.id}`)
  if (data) {
    salon.value = data
    notFound.value = false
    return
  }
  // Only a confirmed 404 means the record genuinely doesn't exist. Any other
  // error (network failure, 5xx, etc.) -- notably the refetch triggered by
  // onUpdated() right after a successful approve/reject/suspend -- must not
  // wipe already-known-good salon state; the apiFetch call above already
  // surfaces a toast for it.
  if (error?.status === 404) notFound.value = true
}

function onUpdated(updated: { id: string; status: string }) {
  if (salon.value) salon.value.status = updated.status as SalonDetail['status']
  load()
}

onMounted(load)
</script>

<template>
  <div class="space-y-4 p-6">
    <p v-if="notFound" class="text-sm text-red-600">آرایشگاه یافت نشد.</p>
    <template v-else-if="salon">
      <h1 class="text-lg font-bold">{{ salon.name }}</h1>
      <p class="text-sm text-gray-500">{{ salon.city }} — {{ salon.address }}</p>
      <p v-if="salon.description" class="text-sm">{{ salon.description }}</p>
      <p class="text-sm">ظرفیت همزمان: {{ salon.capacity }}</p>
      <p class="text-sm">وضعیت: {{ salon.status }}</p>
      <p v-if="salon.rejectionReason" class="text-sm text-red-600">دلیل: {{ salon.rejectionReason }}</p>

      <SalonStatusActions :salon-id="salon.id" :status="salon.status" @updated="onUpdated" />
    </template>
  </div>
</template>
