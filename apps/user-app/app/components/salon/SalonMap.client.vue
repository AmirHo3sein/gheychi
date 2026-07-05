<script setup lang="ts">
const props = defineProps<{
  salons: { id: string; name: string; slug: string; distanceKm: number }[]
  center: { lat: number; lng: number }
  salonCoords: Record<string, { lat: number; lng: number }>
}>()

const config = useRuntimeConfig()
const mapEl = useTemplateRef<HTMLDivElement>('mapEl')

let mapInstance: any = null

function loadNeshanSdk(): Promise<void> {
  const w = window as unknown as { L?: unknown }
  if (w.L) return Promise.resolve()

  return new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://static.neshan.org/sdk/leaflet/v1.9.4/neshan-sdk/v1.0.8/index.css'
    document.head.appendChild(link)

    const script = document.createElement('script')
    script.src = 'https://static.neshan.org/sdk/leaflet/v1.9.4/neshan-sdk/v1.0.8/index.js'
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Failed to load Neshan SDK'))
    document.head.appendChild(script)
  })
}

onMounted(async () => {
  try {
    await loadNeshanSdk()
  } catch {
    return // map silently unavailable; the list view (already rendered) remains usable
  }
  const L = (window as unknown as { L: any }).L

  mapInstance = new L.Map(mapEl.value, {
    key: config.public.neshanApiKey,
    maptype: 'standard-day',
    center: [props.center.lat, props.center.lng],
    zoom: 13,
    poi: false,
    traffic: false,
  })

  for (const salon of props.salons) {
    const coords = props.salonCoords[salon.id]
    if (!coords) continue
    L.marker([coords.lat, coords.lng]).addTo(mapInstance).bindPopup(salon.name)
  }
})

onBeforeUnmount(() => {
  mapInstance?.remove?.()
})
</script>

<template>
  <div ref="mapEl" class="h-96 w-full rounded-xl" />
</template>
