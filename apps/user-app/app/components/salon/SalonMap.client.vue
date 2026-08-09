<script setup lang="ts">
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { googleMapsUrl, neshanUrl } from '../../utils/map-links'

const props = withDefaults(
  defineProps<{
    salons: { id: string; name: string; slug: string; distanceKm: number }[]
    center: { lat: number; lng: number }
    salonCoords: Record<string, { lat: number; lng: number }>
    /**
     * A salon profile embeds this map mid-scroll, where an always-draggable Leaflet
     * instance is a well-known mobile anti-pattern: a finger that lands on the map while
     * scrolling the page gets captured by the map's own pan gesture instead, so the page
     * silently stops scrolling. Compact mode starts with dragging/zoom/scroll-capture
     * disabled and a tap-to-activate overlay; index.vue's dedicated full-screen map view
     * (where panning around IS the point) leaves this false and keeps today's behavior
     * unchanged. Also renders shorter (12rem vs 24rem) -- a secondary "where is it"
     * reference, not the main content of the screen it's embedded in.
     */
    compact?: boolean
  }>(),
  { compact: false },
)

const mapEl = useTemplateRef<HTMLDivElement>('mapEl')
// Only meaningful in compact mode -- true once the tap-to-activate overlay has been
// dismissed and the map behaves like a normal interactive Leaflet instance.
const activated = ref(!props.compact)

let mapInstance: L.Map | null = null

function activate() {
  if (!mapInstance || activated.value) return
  activated.value = true
  mapInstance.dragging.enable()
  mapInstance.scrollWheelZoom.enable()
  mapInstance.doubleClickZoom.enable()
  mapInstance.touchZoom.enable()
  // Constructed with zoomControl:false in compact mode (see initMap below), so the
  // control has to be added now rather than merely re-enabled. Default position
  // (top-left), matching the non-compact map's own zoomControl:true default exactly.
  L.control.zoom().addTo(mapInstance)
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

let unmounted = false

function initMap() {
  if (unmounted) return
  if (!mapEl.value) {
    // When this component is created as part of an ancestor Suspense boundary's
    // initial resolve (e.g. mounted unconditionally on first render of an async-setup
    // page, as opposed to index.vue's post-interaction v-if toggle), Vue can invoke
    // this onMounted hook a tick before the template ref is actually committed to the
    // DOM -- confirmed live: mapEl.value is null here, then non-null one nextTick()
    // later. Retrying once after a tick covers that race without affecting the normal
    // (already-attached) case, where this branch is never taken.
    nextTick(initMap)
    return
  }

  mapInstance = L.map(mapEl.value, {
    zoomControl: !props.compact,
    // Compact mode starts fully non-interactive -- activate() (triggered by the
    // tap-to-activate overlay) re-enables each of these and adds the zoom control back.
    dragging: !props.compact,
    scrollWheelZoom: !props.compact,
    doubleClickZoom: !props.compact,
    touchZoom: !props.compact,
  }).setView([props.center.lat, props.center.lng], 13)

  // CARTO's free Voyager tiles -- no API key, no per-request cost, and a cleaner/
  // softer look than raw OpenStreetMap's default style.
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19,
  }).addTo(mapInstance)

  for (const salon of props.salons) {
    const coords = props.salonCoords[salon.id]
    if (!coords) continue
    // maxWidth 240 rather than Leaflet's 300px default: at 320px this map container is only
    // 288px wide, so a popup allowed to grow to 300px can never be panned fully into view
    // (autoPan has nowhere to pan it to) and stays partly clipped by the container's
    // overflow-hidden -- taking a directions link with it. 240 leaves room for the popup's
    // own tip and shadow at the hard floor; it only binds for long salon names, since the
    // popup sizes to its content below that.
    L.marker([coords.lat, coords.lng])
      .addTo(mapInstance)
      .bindPopup(popupHtml(salon, coords), { maxWidth: 240 })
  }
}

onMounted(initMap)

onBeforeUnmount(() => {
  unmounted = true
  mapInstance?.remove()
  mapInstance = null
})
</script>

<!--
  isolate (on the root div below) is load-bearing, not decoration: Leaflet's own panes/
  controls use z-index up to 1000, and .leaflet-container never sets a z-index of its own --
  without a stacking context here, those values leak out and can paint over same-page
  elements with a much higher paint order, including full-screen fixed overlays like
  StoryViewer (z-50): the map sits in normal document flow behind it, but its escaped
  Leaflet controls don't respect that and render on top wherever the map happens to be
  scrolled to on screen.
  This comment is deliberately OUTSIDE <template>, not inside it: a comment as the first node
  inside <template> makes Vue treat the component as multi-root, which silently disables
  automatic $attrs fallthrough (data-testid="salon-map" from the parent stopped reaching this
  div, with only a console warning -- no error, no visual sign, just a test that couldn't
  find the element anymore). Confirmed by moving it here instead. The compact-mode overlay
  button below is nested INSIDE this one root, not a sibling, for the same reason -- a second
  root-level element would make the component genuinely multi-root, not just an ignorable
  comment, and break the same fallthrough.
-->
<template>
  <div class="isolate relative w-full overflow-hidden rounded-2xl" :class="compact ? 'h-48' : 'h-96'">
    <div ref="mapEl" class="h-full w-full" />
    <button
      v-if="compact && !activated"
      type="button"
      data-testid="salon-map-activate"
      class="absolute inset-0 z-[1001] flex items-center justify-center bg-(--color-text)/10 backdrop-blur-[1px] transition-colors hover:bg-(--color-text)/15"
      @click="activate"
    >
      <span class="flex items-center gap-1.5 rounded-full bg-(--color-surface-card) px-3.5 py-2 text-xs font-semibold text-(--color-text) shadow-(--shadow-md)">
        <BaseIcon name="map-pin" :size="14" />
        برای نقشه تعاملی لمس کنید
      </span>
    </button>
  </div>
</template>

<style>
/* Global (not scoped): Leaflet renders popup content outside this component's DOM tree. */
.salon-map-popup-name {
  margin: 0 0 0.35rem;
  font-weight: 700;
  font-size: 0.85rem;
  /* A provider-authored name can be one unbreakable token; inside a popup that is capped
     at 240px it has to be allowed to break rather than force the popup wider. */
  overflow-wrap: anywhere;
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
  /* These two links are the only actionable things in the popup, and they're tapped on a
     map, where a finger is already imprecise. At their natural ~15px line box they were
     well under the 44px minimum; the flex box gives them a real target without changing
     how they read. */
  display: flex;
  align-items: center;
  min-height: 2.75rem;
}
</style>
