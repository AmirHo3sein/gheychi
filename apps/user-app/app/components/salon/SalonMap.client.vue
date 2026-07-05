<script lang="ts">
// Module-scope singleton (not per-instance): `SalonMap` is toggled in/out via
// `v-if` in index.vue, so each list<->map cycle creates a fresh component
// instance. Without hoisting this above the component, a rapid re-toggle before
// the first load's `onload`/`onerror` fires would see `window.L` still unset and
// inject a second, duplicate `<script>`/`<link>` pair.
let sdkPromise: Promise<void> | null = null
</script>

<script setup lang="ts">
const props = defineProps<{
  salons: { id: string; name: string; slug: string; distanceKm: number }[]
  center: { lat: number; lng: number }
  salonCoords: Record<string, { lat: number; lng: number }>
}>()

const config = useRuntimeConfig()
const mapEl = useTemplateRef<HTMLDivElement>('mapEl')

let mapInstance: any = null
let isMounted = false

function loadNeshanSdk(): Promise<void> {
  const w = window as unknown as { L?: unknown }
  if (w.L) return Promise.resolve()
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise((resolve, reject) => {
    // No Subresource Integrity hash on these CDN assets -- the pinned version in
    // the URL protects against a silent upgrade, but not a compromised origin.
    // Accepted tradeoff for a vendor map SDK loaded this way; not an oversight.
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://static.neshan.org/sdk/leaflet/v1.9.4/neshan-sdk/v1.0.8/index.css'
    document.head.appendChild(link)

    const script = document.createElement('script')
    script.src = 'https://static.neshan.org/sdk/leaflet/v1.9.4/neshan-sdk/v1.0.8/index.js'
    script.onload = () => resolve()
    script.onerror = () => {
      sdkPromise = null // allow a future toggle to retry the load
      reject(new Error('Failed to load Neshan SDK'))
    }
    document.head.appendChild(script)
  })
  return sdkPromise
}

onMounted(async () => {
  isMounted = true

  try {
    await loadNeshanSdk()
  } catch {
    return // map silently unavailable; the list view (already rendered) remains usable
  }

  // The component may have been unmounted (user toggled back to list) while the
  // SDK load was still in flight -- `mapEl.value` would already be cleared, and
  // constructing on a null/stale element would throw.
  if (!isMounted || !mapEl.value) return

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
  isMounted = false
  mapInstance?.remove?.()
})
</script>

<template>
  <div ref="mapEl" class="h-96 w-full rounded-xl" />
</template>
