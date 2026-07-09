<!-- apps/provider-panel/src/components/onboarding/SalonPinPicker.vue -->
<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { onBeforeUnmount, onMounted, useTemplateRef } from 'vue'

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

onMounted(() => {
  if (!mapEl.value) return

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
    emit('update:modelValue', { lat: pos.lat, lng: pos.lng })
  })
  mapInstance.on('click', (e: L.LeafletMouseEvent) => {
    marker!.setLatLng(e.latlng)
    emit('update:modelValue', { lat: e.latlng.lat, lng: e.latlng.lng })
  })

  if (!props.modelValue) {
    emit('update:modelValue', { lat: start.lat, lng: start.lng })
  }
})

onBeforeUnmount(() => {
  mapInstance?.remove()
  mapInstance = null
  marker = null
})
</script>

<template>
  <div ref="mapEl" class="h-64 w-full rounded-xl border border-(--color-border)" />
</template>
