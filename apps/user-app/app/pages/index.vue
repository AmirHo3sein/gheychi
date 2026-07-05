<script setup lang="ts">
import { CITY_CENTERS } from '../utils/city-centers'
import { toSearchGender } from '../utils/gender-map'
import type { SearchResult } from '../utils/types'

const session = useSessionStore()
const { apiFetch } = useApi()

const categories = ref<{ id: number; name: string; icon: string }[]>([])
const salons = ref<SearchResult[]>([])
const selectedCategoryId = ref<number | null>(null)
const sort = ref<'distance' | 'rating'>('distance')
const coords = ref<{ lat: number; lng: number }>({ lat: CITY_CENTERS[0].lat, lng: CITY_CENTERS[0].lng })
const selectedCity = ref(CITY_CENTERS[0].name)
const loading = ref(true)
const view = ref<'list' | 'map'>('list')
const salonCoords = ref<Record<string, { lat: number; lng: number }>>({})

const searchGender = computed(() => toSearchGender(session.user?.gender))

function selectCity(city: (typeof CITY_CENTERS)[number]) {
  selectedCity.value = city.name
  coords.value = { lat: city.lat, lng: city.lng }
}

async function loadSalons() {
  loading.value = true
  const { data } = await apiFetch<SearchResult[]>('/search', {
    query: {
      lat: coords.value.lat,
      lng: coords.value.lng,
      gender: searchGender.value,
      categoryId: selectedCategoryId.value ?? undefined,
      sort: sort.value,
    },
    silent: true,
  })
  salons.value = data ?? []
  loading.value = false
}

onMounted(async () => {
  const { data } = await apiFetch<typeof categories.value>('/categories')
  categories.value = data ?? []

  if (import.meta.client && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        coords.value = { lat: pos.coords.latitude, lng: pos.coords.longitude }
        loadSalons()
      },
      () => loadSalons(), // permission denied / unavailable -- fall back to the default city already in coords
      { timeout: 5000 },
    )
  } else {
    await loadSalons()
  }
})

watch([selectedCategoryId, sort], loadSalons)

async function loadCoordsForMap() {
  const missing = salons.value.filter((s) => !salonCoords.value[s.id])
  const results = await Promise.all(
    missing.map((s) => apiFetch<{ location: { coordinates: [number, number] } }>(`/salons/${s.slug}`, { silent: true })),
  )
  for (let i = 0; i < missing.length; i++) {
    const data = results[i].data
    if (data) salonCoords.value[missing[i].id] = { lat: data.location.coordinates[1], lng: data.location.coordinates[0] }
  }
}

watch(view, (v) => {
  if (v === 'map') loadCoordsForMap()
})
</script>

<template>
  <div class="p-4 space-y-4">
    <select :value="selectedCity" class="rounded-lg border p-2 text-sm" @change="(e) => selectCity(CITY_CENTERS.find((c) => c.name === (e.target as HTMLSelectElement).value)!)">
      <option v-for="city in CITY_CENTERS" :key="city.name" :value="city.name">{{ city.name }}</option>
    </select>

    <div class="flex gap-2 overflow-x-auto">
      <button
        type="button"
        class="whitespace-nowrap rounded-full px-3 py-1 text-sm"
        :class="selectedCategoryId === null ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'"
        @click="selectedCategoryId = null"
      >
        همه
      </button>
      <button
        v-for="cat in categories"
        :key="cat.id"
        type="button"
        class="whitespace-nowrap rounded-full px-3 py-1 text-sm"
        :class="selectedCategoryId === cat.id ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'"
        @click="selectedCategoryId = cat.id"
      >
        {{ cat.name }}
      </button>
    </div>

    <div class="flex gap-2">
      <button type="button" class="rounded-full px-3 py-1 text-sm" :class="view === 'list' ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'" @click="view = 'list'">لیست</button>
      <button type="button" class="rounded-full px-3 py-1 text-sm" :class="view === 'map' ? 'bg-(--color-accent) text-white' : 'bg-(--color-surface-card)'" @click="view = 'map'">نقشه</button>
    </div>

    <SalonMap v-if="view === 'map'" :salons="salons" :center="coords" :salon-coords="salonCoords" />
    <template v-else>
      <p v-if="loading" class="text-sm text-center">در حال بارگذاری...</p>
      <p v-else-if="!salons.length" class="text-sm text-center">سالنی در این منطقه پیدا نشد</p>
      <div v-else class="space-y-3">
        <SalonCard v-for="salon in salons" :key="salon.id" :salon="salon" />
      </div>
    </template>
  </div>
</template>
