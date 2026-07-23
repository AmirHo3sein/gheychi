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
/** How long a press must be held before it counts as "hold to pause" rather than a tap-to-navigate. */
const HOLD_THRESHOLD_MS = 350

const index = ref(0)
/** Bumped on every story change to force-remount the active progress-fill element,
 *  restarting its CSS animation from 0% (see the `.story-fill` keyframe below). */
const playKey = ref(0)
const isPaused = ref(false)
const reducedMotion = ref(false)

const current = computed(() => props.stories[index.value]!)
const currentService = computed(() => {
  const serviceId = current.value.serviceId
  if (!serviceId) return null
  return props.services.find((service) => service.id === serviceId) ?? null
})

const reportOpen = ref(false)

function markSeen() {
  recordStorySeen(props.salonId, current.value.createdAt)
}

// --- Auto-advance timer ------------------------------------------------------
// A single setTimeout per story triggers the next()-story advance. The visual
// progress fill is driven entirely by a CSS animation (compositor-only, zero JS
// per frame) -- no interval/tick loop runs while the viewer is open.
let advanceTimer: ReturnType<typeof setTimeout> | undefined
let advanceStartedAt = 0
let advanceRemainingMs = STORY_DURATION_MS

function clearAdvanceTimer() {
  if (advanceTimer !== undefined) {
    clearTimeout(advanceTimer)
    advanceTimer = undefined
  }
}

function scheduleAdvance(durationMs: number) {
  clearAdvanceTimer()
  // Reduced-motion users get no auto-advance at all -- next()/prev() only via tap
  // (WCAG 2.2.2 by construction: there is nothing time-based left to pause).
  if (reducedMotion.value) return
  advanceStartedAt = Date.now()
  advanceRemainingMs = durationMs
  advanceTimer = setTimeout(next, durationMs)
}

function startTimer() {
  playKey.value += 1
  isPaused.value = false
  scheduleAdvance(STORY_DURATION_MS)
}

function pausePlayback() {
  if (isPaused.value) return
  isPaused.value = true
  if (advanceTimer !== undefined) {
    advanceRemainingMs = Math.max(0, advanceRemainingMs - (Date.now() - advanceStartedAt))
    clearAdvanceTimer()
  }
}

/** Resumes from wherever playback was paused -- pause/resume, not replay. */
function resumePlayback() {
  if (!isPaused.value) return
  isPaused.value = false
  scheduleAdvance(advanceRemainingMs)
}

// --- Tap-and-hold to pause (WCAG 2.2.2 "Pause, Stop, Hide") ------------------
// A short hold pauses auto-advance (and freezes the CSS fill via isPaused below);
// releasing resumes in place. A quick tap still navigates as before -- click only
// fires without navigating when the press crossed the hold threshold.
let holdTimer: ReturnType<typeof setTimeout> | undefined
let heldThisPress = false

function onZoneHoldStart() {
  heldThisPress = false
  holdTimer = setTimeout(() => {
    heldThisPress = true
    pausePlayback()
  }, HOLD_THRESHOLD_MS)
}

function onZoneHoldEnd() {
  if (holdTimer !== undefined) {
    clearTimeout(holdTimer)
    holdTimer = undefined
  }
  resumePlayback()
}

function onZoneClick(direction: 'prev' | 'next') {
  if (heldThisPress) {
    // A hold-then-release resumes playback in place; it must not also navigate.
    heldThisPress = false
    return
  }
  if (direction === 'prev') prev()
  else next()
}

function openReport() {
  // Auto-advance pauses while the form is up -- the reported story stays on screen.
  pausePlayback()
  reportOpen.value = true
}

function closeReport() {
  reportOpen.value = false
  resumePlayback()
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

let unlockScroll: (() => void) | undefined
let motionQuery: MediaQueryList | undefined

function onMotionPreferenceChange(event: MediaQueryListEvent) {
  reducedMotion.value = event.matches
  if (reducedMotion.value) {
    clearAdvanceTimer()
  } else {
    playKey.value += 1
    scheduleAdvance(STORY_DURATION_MS)
  }
}

onMounted(() => {
  // Full-screen overlay: freeze the salon page underneath so touch drags on the viewer
  // don't scroll it. Restored to the exact prior value on unmount.
  unlockScroll = lockBodyScroll()
  motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotion.value = motionQuery.matches
  motionQuery.addEventListener('change', onMotionPreferenceChange)
  markSeen()
  startTimer()
})

onBeforeUnmount(() => {
  clearAdvanceTimer()
  if (holdTimer !== undefined) clearTimeout(holdTimer)
  motionQuery?.removeEventListener('change', onMotionPreferenceChange)
  unlockScroll?.()
})

const dialogRoot = ref<HTMLElement | null>(null)
// Paused while the embedded ReportForm (its own nested dialog) is open on top --
// Escape while reportOpen is then handled entirely by ReportForm's own useDialog,
// which emits close -> closeReport() above, matching the prior single-listener
// branch ("Escape dismisses the form, not the viewer") with no double-handling.
const { titleId } = useDialog(dialogRoot, { onClose: close, enabled: () => !reportOpen.value })
</script>

<template>
  <div
    ref="dialogRoot"
    data-testid="story-viewer"
    role="dialog"
    aria-modal="true"
    :aria-labelledby="titleId"
    tabindex="-1"
    class="fixed inset-0 z-50 flex flex-col overscroll-contain bg-black outline-none"
  >
    <h2 :id="titleId" class="sr-only">نمایش استوری سالن</h2>

    <!-- Segmented progress bars, one per story, filling in play (oldest-first) order.
         The active segment's fill is a CSS animation (see <style> below), restarted by
         keying it to `playKey` on every story change -- no JS runs per frame. -->
    <div class="flex gap-1 p-3">
      <div v-for="(story, i) in stories" :key="story.id" class="h-1 flex-1 overflow-hidden rounded-full bg-white/30">
        <div v-if="i < index" class="h-full w-full bg-white" />
        <div
          v-else-if="i === index"
          :key="`fill-${playKey}`"
          class="h-full bg-white"
          :class="reducedMotion ? 'w-2/5' : 'story-fill'"
          :style="
            reducedMotion
              ? undefined
              : { animationDuration: `${STORY_DURATION_MS}ms`, animationPlayState: isPaused ? 'paused' : 'running' }
          "
        />
        <div v-else class="h-full w-0 bg-white" />
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
           logical start/end -- the zones mirror with the reading direction on purpose.
           A hold past HOLD_THRESHOLD_MS pauses auto-advance instead of navigating. -->
      <button
        type="button"
        data-testid="story-prev-zone"
        aria-label="استوری قبلی"
        class="absolute inset-y-0 right-0 w-1/2"
        @click="onZoneClick('prev')"
        @pointerdown="onZoneHoldStart"
        @pointerup="onZoneHoldEnd"
        @pointercancel="onZoneHoldEnd"
        @pointerleave="onZoneHoldEnd"
      />
      <button
        type="button"
        data-testid="story-next-zone"
        aria-label="استوری بعدی"
        class="absolute inset-y-0 left-0 w-1/2"
        @click="onZoneClick('next')"
        @pointerdown="onZoneHoldStart"
        @pointerup="onZoneHoldEnd"
        @pointercancel="onZoneHoldEnd"
        @pointerleave="onZoneHoldEnd"
      />

      <button
        type="button"
        data-testid="story-close"
        aria-label="بستن"
        class="absolute top-2 start-2 z-10 rounded-full bg-black/50 p-1.5 text-white"
        @click="close"
      >
        <BaseIcon name="x" :size="18" />
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

<style scoped>
@keyframes story-fill {
  from {
    width: 0%;
  }
  to {
    width: 100%;
  }
}

.story-fill {
  animation-name: story-fill;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

@media (prefers-reduced-motion: reduce) {
  .story-fill {
    animation: none;
  }
}
</style>
