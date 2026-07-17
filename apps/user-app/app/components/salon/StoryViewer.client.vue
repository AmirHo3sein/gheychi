<!-- apps/user-app/app/components/salon/StoryViewer.client.vue -->
<script setup lang="ts">
import type { SalonStoryItem } from '../../utils/types'
import { lockBodyScroll } from '../../utils/scroll-lock'
import { recordStorySeen } from '../../utils/story-seen'

const props = defineProps<{
  /** Oldest-first, exactly as the public endpoint returns them. */
  stories: SalonStoryItem[]
  services: { id: string; name: string }[]
  slug: string
  salonId: string
  /** Same eligibility flag as the salon page's report button (completed booking). */
  canReport?: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const STORY_DURATION_MS = 5000
const TICK_MS = 50

const index = ref(0)
/** 0..1 fill of the current story's progress segment. */
const progress = ref(0)

const current = computed(() => props.stories[index.value]!)
const currentService = computed(() => {
  const serviceId = current.value.serviceId
  if (!serviceId) return null
  return props.services.find((service) => service.id === serviceId) ?? null
})

let timer: ReturnType<typeof setInterval> | undefined

const reportOpen = ref(false)

function markSeen() {
  recordStorySeen(props.salonId, current.value.createdAt)
}

function tick() {
  progress.value = Math.min(1, progress.value + TICK_MS / STORY_DURATION_MS)
  if (progress.value >= 1) next()
}

function startTimer() {
  stopTimer()
  progress.value = 0
  timer = setInterval(tick, TICK_MS)
}

function stopTimer() {
  if (timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }
}

/** Restarts the interval without resetting progress -- pause/resume, not replay. */
function resumeTimer() {
  if (timer !== undefined) return
  timer = setInterval(tick, TICK_MS)
}

function openReport() {
  // Auto-advance pauses while the form is up -- the reported story stays on screen.
  stopTimer()
  reportOpen.value = true
}

function closeReport() {
  reportOpen.value = false
  resumeTimer()
}

function next() {
  if (index.value >= props.stories.length - 1) {
    // Advancing past the last story closes the viewer (spec).
    close()
    return
  }
  index.value += 1
  markSeen()
  startTimer()
}

function prev() {
  if (index.value === 0) {
    // Already at the oldest story -- just restart its timer.
    startTimer()
    return
  }
  index.value -= 1
  startTimer()
}

function close() {
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  // With the report form up, Escape dismisses the form (resuming playback), not the viewer.
  if (event.key === 'Escape') reportOpen.value ? closeReport() : close()
}

let unlockScroll: (() => void) | undefined

onMounted(() => {
  // Full-screen overlay: freeze the salon page underneath so touch drags on the viewer
  // don't scroll it. Restored to the exact prior value on unmount.
  unlockScroll = lockBodyScroll()
  markSeen()
  startTimer()
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  stopTimer()
  window.removeEventListener('keydown', onKeydown)
  unlockScroll?.()
})

function barFill(i: number): number {
  if (i < index.value) return 1
  if (i === index.value) return progress.value
  return 0
}
</script>

<template>
  <div data-testid="story-viewer" class="fixed inset-0 z-50 flex flex-col overscroll-contain bg-black">
    <!-- Segmented progress bars, one per story, filling in play (oldest-first) order. -->
    <div class="flex gap-1 p-3">
      <div v-for="(story, i) in stories" :key="story.id" class="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
        <div class="h-full bg-white" :style="{ width: `${barFill(i) * 100}%` }" />
      </div>
    </div>

    <div class="relative flex-1">
      <NuxtImg
        provider="arvancloud"
        :src="current.url"
        width="720"
        height="1280"
        class="absolute inset-0 h-full w-full object-contain"
        alt=""
      />

      <!-- RTL-aware tap zones: back sits on the physical right (the reading start side),
           forward on the physical left. Deliberate physical left/right classes, not
           logical start/end -- the zones mirror with the reading direction on purpose. -->
      <button type="button" data-testid="story-prev-zone" aria-label="استوری قبلی" class="absolute inset-y-0 right-0 w-1/2" @click="prev" />
      <button type="button" data-testid="story-next-zone" aria-label="استوری بعدی" class="absolute inset-y-0 left-0 w-1/2" @click="next" />

      <button
        type="button"
        data-testid="story-close"
        aria-label="بستن"
        class="absolute top-2 start-2 z-10 rounded-full bg-black/50 px-3 py-1 text-lg text-white"
        @click="close"
      >
        ✕
      </button>

      <!-- Unobtrusive report affordance -- only for customers the salon page already
           verified as report-eligible (completed booking). -->
      <button
        v-if="canReport"
        type="button"
        data-testid="story-report-button"
        class="absolute top-2 end-2 z-10 rounded-full bg-black/50 px-3 py-1 text-xs text-white/80"
        @click="openReport"
      >
        گزارش
      </button>

      <div class="absolute inset-x-0 bottom-0 z-10 space-y-2 p-4 text-center">
        <p v-if="current.caption" data-testid="story-caption" class="text-sm text-white">{{ current.caption }}</p>
        <NuxtLink
          v-if="currentService"
          :to="`/booking/${slug}/${currentService.id}`"
          data-testid="story-booking-pill"
          class="inline-block rounded-full bg-(--color-accent) px-4 py-2 text-sm font-semibold text-white"
        >
          رزرو این خدمت
        </NuxtLink>
      </div>
    </div>

    <!-- Renders above the viewer (same z-index, later in the DOM). Targets the story
         on screen when the form was opened; closing it resumes auto-advance. -->
    <ReportForm v-if="reportOpen" :salon-id="salonId" :story-id="current.id" @close="closeReport" />
  </div>
</template>
