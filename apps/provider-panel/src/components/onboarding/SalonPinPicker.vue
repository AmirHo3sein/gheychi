<!-- apps/provider-panel/src/components/onboarding/SalonPinPicker.vue -->
<script lang="ts">
// Module-scope singleton -- avoids injecting a duplicate <script>/<link> pair if this
// component is ever mounted more than once before the first load's onload/onerror fires.
let sdkPromise: Promise<void> | null = null
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'

const props = defineProps<{
  modelValue: { lat: number; lng: number } | null
  center: { lat: number; lng: number }
}>()

const emit = defineEmits<{
  'update:modelValue': [value: { lat: number; lng: number }]
}>()

const mapEl = useTemplateRef<HTMLDivElement>('mapEl')
const loadFailed = ref(false)

let mapInstance: any = null
let marker: any = null
let isMounted = false

function loadNeshanSdk(): Promise<void> {
  const w = window as unknown as { L?: unknown }
  if (w.L) return Promise.resolve()
  if (sdkPromise) return sdkPromise

  sdkPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = 'https://static.neshan.org/sdk/leaflet/v1.9.4/neshan-sdk/v1.0.8/index.css'
    document.head.appendChild(link)

    const script = document.createElement('script')
    script.src = 'https://static.neshan.org/sdk/leaflet/v1.9.4/neshan-sdk/v1.0.8/index.js'
    script.onload = () => resolve()
    script.onerror = () => {
      sdkPromise = null
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
    loadFailed.value = true
    // Default to the city-center coordinates so a map/network failure doesn't hard-block
    // the rest of onboarding -- the manual lat/lng inputs (shown below) let the provider
    // correct this later from the same screen, or from the salon settings after approval.
    if (!props.modelValue) emit('update:modelValue', { lat: props.center.lat, lng: props.center.lng })
    return
  }
  if (!isMounted || !mapEl.value) return

  const L = (window as unknown as { L: any }).L
  const start = props.modelValue ?? props.center

  mapInstance = new L.Map(mapEl.value, {
    key: import.meta.env.VITE_NESHAN_API_KEY,
    maptype: 'standard-day',
    center: [start.lat, start.lng],
    zoom: 13,
    poi: false,
    traffic: false,
  })

  marker = L.marker([start.lat, start.lng], { draggable: true }).addTo(mapInstance)
  marker.on('dragend', () => {
    const pos = marker.getLatLng()
    emit('update:modelValue', { lat: pos.lat, lng: pos.lng })
  })
  mapInstance.on('click', (e: { latlng: { lat: number; lng: number } }) => {
    marker.setLatLng(e.latlng)
    emit('update:modelValue', { lat: e.latlng.lat, lng: e.latlng.lng })
  })

  if (!props.modelValue) {
    emit('update:modelValue', { lat: start.lat, lng: start.lng })
  }
})

onBeforeUnmount(() => {
  isMounted = false
  mapInstance?.remove?.()
})
</script>

<template>
  <div>
    <div v-if="!loadFailed" ref="mapEl" class="h-72 w-full rounded-xl" />
    <div v-else class="space-y-2 rounded-xl border p-3">
      <p class="text-sm text-red-600">
        نقشه بارگذاری نشد. مختصات را به‌صورت دستی وارد کنید (بعداً هم قابل ویرایش است).
      </p>
      <div class="flex gap-2">
        <input
          data-testid="manual-lat"
          type="number"
          step="any"
          :value="modelValue?.lat ?? center.lat"
          placeholder="عرض جغرافیایی"
          class="flex-1 rounded-lg border p-2"
          @change="emit('update:modelValue', { lat: +($event.target as HTMLInputElement).value, lng: modelValue?.lng ?? center.lng })"
        />
        <input
          data-testid="manual-lng"
          type="number"
          step="any"
          :value="modelValue?.lng ?? center.lng"
          placeholder="طول جغرافیایی"
          class="flex-1 rounded-lg border p-2"
          @change="emit('update:modelValue', { lat: modelValue?.lat ?? center.lat, lng: +($event.target as HTMLInputElement).value })"
        />
      </div>
    </div>
  </div>
</template>
