<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

const props = defineProps<{
  salons: { id: string; name: string; slug: string; distanceKm: number }[]
  center: { lat: number; lng: number }
  salonCoords: Record<string, { lat: number; lng: number }>
}>()

const mapEl = useTemplateRef<HTMLDivElement>('mapEl')

let mapInstance: L.Map | null = null

// Iran-friendly directions: nshn.ir opens the Neshan app if installed (else its web
// map), a domestically-hosted service that works reliably inside Iran. Google Maps is
// offered as a second option since some users prefer it -- it needs no API key either
// (a plain https://www.google.com/maps/dir/ URL, not the paid Directions API).
function neshanUrl(lat: number, lng: number): string {
  return `https://nshn.ir/?lat=${lat}&lng=${lng}`
}
function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
}

function popupHtml(salon: { name: string; slug: string }, coords: { lat: number; lng: number }): string {
  const name = salon.name.replace(/</g, '&lt;')
  return `
    <div class="salon-map-popup">
      <p class="salon-map-popup-name">${name}</p>
      <div class="salon-map-popup-actions">
        <a href="${neshanUrl(coords.lat, coords.lng)}" target="_blank" rel="noopener">مسیریابی با نشان</a>
        <a href="${googleMapsUrl(coords.lat, coords.lng)}" target="_blank" rel="noopener">مسیریابی با گوگل مپ</a>
      </div>
    </div>
  `
}

onMounted(() => {
  if (!mapEl.value) return

  mapInstance = L.map(mapEl.value, { zoomControl: true }).setView([props.center.lat, props.center.lng], 13)

  // CARTO's free Voyager tiles -- no API key, no per-request cost, and a cleaner/
  // softer look than raw OpenStreetMap's default style.
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  }).addTo(mapInstance)

  for (const salon of props.salons) {
    const coords = props.salonCoords[salon.id]
    if (!coords) continue
    L.marker([coords.lat, coords.lng]).addTo(mapInstance).bindPopup(popupHtml(salon, coords))
  }
})

onBeforeUnmount(() => {
  mapInstance?.remove()
  mapInstance = null
})
</script>

<template>
  <div ref="mapEl" class="h-96 w-full rounded-xl" />
</template>

<style>
/* Global (not scoped): Leaflet renders popup content outside this component's DOM tree. */
.salon-map-popup-name {
  margin: 0 0 0.35rem;
  font-weight: 700;
  font-size: 0.85rem;
}
.salon-map-popup-actions {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.salon-map-popup-actions a {
  font-size: 0.78rem;
  color: var(--color-accent);
  font-weight: 600;
}
</style>
