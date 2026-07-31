<!-- apps/provider-panel/src/components/onboarding/SalonPinPicker.vue -->
<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { onBeforeUnmount, onMounted, ref, useId, useTemplateRef } from 'vue'

const props = defineProps<{
  modelValue: { lat: number; lng: number } | null
  center: { lat: number; lng: number }
}>()

const emit = defineEmits<{
  'update:modelValue': [value: { lat: number; lng: number }]
}>()

const mapEl = useTemplateRef<HTMLDivElement>('mapEl')

let mapInstance: L.Map | null = null
let marker: L.Marker | null = null

// Keyboard-accessible fallback for the map's required lat/lng: Leaflet's own keyboard
// nav only pans/zooms the map, it never moves the marker, so a keyboard-only user has no
// way to satisfy this required field through the map widget alone. These two plain
// number inputs are a first-class alternative input path, not just a display mirror --
// entering a value here is exactly as "explicit" a commit as a drag or a click.
const latId = useId()
const lngId = useId()
const latInput = ref(props.modelValue ? String(props.modelValue.lat) : '')
const lngInput = ref(props.modelValue ? String(props.modelValue.lng) : '')

// Shared by marker drag, map click, and the manual inputs so all three paths stay in
// sync and every path emits the same way.
function commit(lat: number, lng: number, opts: { pan?: boolean } = {}) {
  marker?.setLatLng([lat, lng])
  if (opts.pan) mapInstance?.panTo([lat, lng])
  latInput.value = String(lat)
  lngInput.value = String(lng)
  emit('update:modelValue', { lat, lng })
}

function applyManualCoords() {
  const lat = Number(latInput.value)
  const lng = Number(lngInput.value)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return
  commit(lat, lng, { pan: true })
}

onMounted(() => {
  if (!mapEl.value) return

  // Only ever a VIEW seed, never an implicit commit -- props.modelValue is only non-null
  // here when a real value was already saved (e.g. editing an existing salon); a brand
  // new onboarding flow starts from the generic city center but must NOT auto-emit that
  // as if the owner had confirmed it (see below).
  const start = props.modelValue ?? props.center
  mapInstance = L.map(mapEl.value, { zoomControl: true }).setView([start.lat, start.lng], 13)

  // CARTO's free Voyager tiles -- no API key, no per-request cost.
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  }).addTo(mapInstance)

  marker = L.marker([start.lat, start.lng], { draggable: true }).addTo(mapInstance)
  marker.on('dragend', () => {
    const pos = marker!.getLatLng()
    commit(pos.lat, pos.lng)
  })
  mapInstance.on('click', (e: L.LeafletMouseEvent) => {
    commit(e.latlng.lat, e.latlng.lng)
  })

  // Deliberately no auto-emit here. Emitting the default center on mount used to let an
  // owner submit a listing whose real geo-point silently defaulted to the wrong city's
  // center -- lat/lng only becomes "set" once the owner actually drags/clicks the map or
  // fills in the coordinate inputs below.
})

onBeforeUnmount(() => {
  mapInstance?.remove()
  mapInstance = null
  marker = null
})
</script>

<template>
  <div class="space-y-2">
    <!--
      A fixed h-64 is right on a phone (any taller and the coordinate fields and the wizard's
      next button fall below the fold), but it wastes a desktop setup session where placing
      the pin accurately is the whole point -- so it grows with the viewport instead.
    -->
    <div ref="mapEl" class="h-64 w-full rounded-xl border border-(--color-border) sm:h-80 lg:h-96" />
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label :for="latId" class="mb-1 block text-xs font-medium text-(--color-text-muted)">عرض جغرافیایی (Lat)</label>
        <input
          :id="latId"
          v-model="latInput"
          data-testid="pin-lat"
          type="number"
          step="any"
          min="-90"
          max="90"
          placeholder="مثلاً ۳۵.۷"
          class="tnum w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-2 text-sm"
          @change="applyManualCoords"
        />
      </div>
      <div>
        <label :for="lngId" class="mb-1 block text-xs font-medium text-(--color-text-muted)">طول جغرافیایی (Lng)</label>
        <input
          :id="lngId"
          v-model="lngInput"
          data-testid="pin-lng"
          type="number"
          step="any"
          min="-180"
          max="180"
          placeholder="مثلاً ۵۱.۴"
          class="tnum w-full rounded-xl border border-(--color-border) bg-(--color-surface-card) p-2 text-sm"
          @change="applyManualCoords"
        />
      </div>
    </div>
    <p class="text-xs text-(--color-text-muted)">
      برای انتخاب دقیق‌تر روی نقشه کلیک یا نشانگر را بکشید، یا مختصات را مستقیم وارد کنید.
    </p>
  </div>
</template>

<style scoped>
/* Leaflet's stock zoom buttons render at 26px -- under the 44px touch-target floor. */
:deep(.leaflet-control-zoom-in),
:deep(.leaflet-control-zoom-out) {
  width: 44px !important;
  height: 44px !important;
  line-height: 44px !important;
  font-size: 20px;
}
</style>
