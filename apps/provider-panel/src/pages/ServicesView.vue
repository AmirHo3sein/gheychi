<!-- apps/provider-panel/src/pages/ServicesView.vue -->
<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useApi } from '@/composables/useApi'

interface Service {
  id: string
  categoryId: number
  name: string
  price: number
  durationMin: number
  isActive: boolean
}

const { apiFetch } = useApi()
const services = ref<Service[]>([])
const categories = ref<{ id: number; name: string }[]>([])
const newService = reactive({ categoryId: null as number | null, name: '', price: 0, durationMin: 30 })

async function load() {
  const { data } = await apiFetch<Service[]>('/salons/mine/services', { silent: true })
  services.value = data ?? []
}

onMounted(async () => {
  const [categoriesRes] = await Promise.all([apiFetch<{ id: number; name: string }[]>('/categories', { silent: true }), load()])
  categories.value = categoriesRes.data ?? []
})

async function addService() {
  if (!newService.categoryId || newService.name.trim().length < 2) return
  await apiFetch('/salons/mine/services', { method: 'POST', body: { ...newService } })
  newService.categoryId = null
  newService.name = ''
  newService.price = 0
  newService.durationMin = 30
  await load()
}

// NOTE: GET /salons/mine/services only ever returns isActive: true rows, and
// PATCH /salons/mine/services/:id looks the service up scoped to isActive: true
// (see salon-services.controller.ts `update()`), so a deactivated service can never
// be found again to be reactivated -- it simply disappears from this list after
// DELETE. There is no reactivation path in the API today, so this is a one-way
// "deactivate" action, not a bidirectional toggle.
async function deactivate(service: Service) {
  await apiFetch(`/salons/mine/services/${service.id}`, { method: 'DELETE' })
  await load()
}

async function updatePrice(service: Service, price: number) {
  await apiFetch(`/salons/mine/services/${service.id}`, { method: 'PATCH', body: { price } })
}
</script>

<template>
  <div class="space-y-4 p-4">
    <h1 class="text-lg font-bold">خدمات و قیمت‌ها</h1>

    <div v-for="s in services" :key="s.id" class="flex items-center justify-between rounded-lg border p-3">
      <div>
        <p class="font-bold">{{ s.name }}</p>
        <input
          :value="s.price"
          type="number"
          class="w-28 rounded border p-1 text-sm"
          @change="updatePrice(s, +($event.target as HTMLInputElement).value)"
        />
      </div>
      <label class="flex items-center gap-2 text-sm">
        <input type="checkbox" :checked="s.isActive" @change="deactivate(s)" />
        فعال
      </label>
    </div>

    <div class="space-y-2 rounded-lg border p-3">
      <h2 class="font-bold">افزودن خدمت جدید</h2>
      <select v-model.number="newService.categoryId" class="w-full rounded-lg border p-2">
        <option :value="null" disabled>دسته‌بندی</option>
        <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <input v-model="newService.name" placeholder="نام خدمت" class="w-full rounded-lg border p-2" />
      <input v-model.number="newService.price" type="number" placeholder="قیمت" class="w-full rounded-lg border p-2" />
      <input v-model.number="newService.durationMin" type="number" placeholder="مدت زمان (دقیقه)" class="w-full rounded-lg border p-2" />
      <button type="button" class="w-full rounded-lg bg-(--color-accent) p-2 text-white" @click="addService">افزودن</button>
    </div>
  </div>
</template>
