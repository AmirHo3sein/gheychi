<script setup lang="ts">
export type IconName =
  | 'phone'
  | 'shield'
  | 'user'
  | 'chevron-back'
  | 'chevron-forward'
  | 'spinner'
  | 'check'
  | 'check-circle'
  | 'x'
  | 'alert-circle'
  | 'star'
  | 'heart'
  | 'camera'
  | 'search'
  | 'map-pin'
  | 'calendar'
  | 'clock'
  | 'moon'
  | 'sun'
  | 'menu'
  | 'flag'
  | 'sparkles'
  | 'instagram'
  | 'play'
  | 'pause'
  | 'monitor'
  | 'scissors'
  | 'palette'
  | 'droplet'
  | 'nail'
  | 'brush'
  | 'eye'
  | 'razor'
  | 'pencil'
  | 'logout'

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 20 })
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <template v-if="name === 'phone'">
      <path d="M4 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L14 13l5 2v4a2 2 0 0 1-2 2A15 15 0 0 1 4 6a2 2 0 0 1 0-2Z" />
    </template>
    <template v-else-if="name === 'shield'">
      <path d="M12 3 4 6v6c0 4.5 3 7.5 8 9 5-1.5 8-4.5 8-9V6l-8-3Z" />
      <path d="m9 12 2 2 4-4" />
    </template>
    <template v-else-if="name === 'user'">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.9 3.1-6 7-6s7 2.1 7 6" />
    </template>
    <template v-else-if="name === 'chevron-back'">
      <path d="m15 6-6 6 6 6" />
    </template>
    <template v-else-if="name === 'chevron-forward'">
      <path d="m9 6 6 6-6 6" />
    </template>
    <template v-else-if="name === 'spinner'">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </template>
    <template v-else-if="name === 'check'">
      <path d="m5 12 5 5L20 7" />
    </template>
    <template v-else-if="name === 'check-circle'">
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </template>
    <template v-else-if="name === 'x'">
      <path d="M6 6l12 12M18 6 6 18" />
    </template>
    <template v-else-if="name === 'alert-circle'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16" r="0.6" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'star'">
      <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" />
    </template>
    <template v-else-if="name === 'heart'">
      <path d="M12 20.5s-7.5-4.6-9.7-9.2C.8 7.9 2.7 4.5 6 4c2-.3 3.6.7 6 3 2.4-2.3 4-3.3 6-3 3.3.5 5.2 3.9 3.7 7.3-2.2 4.6-9.7 9.2-9.7 9.2Z" />
    </template>
    <template v-else-if="name === 'camera'">
      <path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.3" />
    </template>
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </template>
    <template v-else-if="name === 'map-pin'">
      <path d="M12 21s7-6.4 7-11.5a7 7 0 1 0-14 0C5 14.6 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </template>
    <template v-else-if="name === 'calendar'">
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </template>
    <template v-else-if="name === 'clock'">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </template>
    <template v-else-if="name === 'moon'">
      <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" />
    </template>
    <template v-else-if="name === 'sun'">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.3M12 19.2v2.3M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2.5 12h2.3M19.2 12h2.3M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
    </template>
    <template v-else-if="name === 'menu'">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </template>
    <template v-else-if="name === 'flag'">
      <path d="M6 21V4" />
      <path d="M6 4h11l-2.5 3.5L17 11H6" />
    </template>
    <template v-else-if="name === 'sparkles'">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="m6 6 2 2M16 16l2 2M18 6l-2 2M8 16l-2 2" />
      <circle cx="12" cy="12" r="2.2" />
    </template>
    <template v-else-if="name === 'instagram'">
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'play'">
      <path d="M7 5.5v13l11-6.5-11-6.5Z" />
    </template>
    <template v-else-if="name === 'pause'">
      <path d="M7 5v14M17 5v14" />
    </template>
    <template v-else-if="name === 'monitor'">
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M8.5 20h7M12 16.5V20" />
    </template>
    <template v-else-if="name === 'scissors'">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <path d="m20 4-9.5 9.5M14.5 14.5 20 20M8.1 8.1 12 12" />
    </template>
    <template v-else-if="name === 'palette'">
      <path d="M12 4a8 8 0 1 0 8 8c0-1-.8-1.5-1.8-1.5h-2a2 2 0 0 1-2-2c0-.6.3-1.1.7-1.5.4-.4.7-.9.7-1.5C15.6 4.7 14 4 12 4Z" />
      <circle cx="8" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="14" r="1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="16" r="1" fill="currentColor" stroke="none" />
    </template>
    <template v-else-if="name === 'droplet'">
      <path d="M12 3.5s5.5 6.2 5.5 10.3a5.5 5.5 0 1 1-11 0C6.5 9.7 12 3.5 12 3.5Z" />
    </template>
    <template v-else-if="name === 'nail'">
      <path d="M9.5 3h5v3.2l2 2.3v9.5a3 3 0 0 1-3 3h-3a3 3 0 0 1-3-3V8.5l2-2.3V3Z" />
      <path d="M9.5 8.5h5" />
    </template>
    <template v-else-if="name === 'brush'">
      <path d="M18.5 3.5a2.1 2.1 0 0 1 0 3l-7 7-3-3 7-7a2.1 2.1 0 0 1 3 0Z" />
      <path d="M9.8 12.2 4 18a1.7 1.7 0 0 0 2.4 2.4l5.8-5.8" />
    </template>
    <template v-else-if="name === 'eye'">
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </template>
    <template v-else-if="name === 'razor'">
      <rect x="3.5" y="10" width="17" height="4" rx="1" />
      <path d="M8 10V6.5M16 10V6.5M8 14v3.5M16 14v3.5" />
    </template>
    <template v-else-if="name === 'pencil'">
      <path d="m14.5 4.5 5 5L8.5 20.5H3.5v-5Z" />
      <path d="m14.5 4.5 5 5" />
    </template>
    <template v-else-if="name === 'logout'">
      <path d="M9.5 20H5.5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" />
      <path d="m15.5 16 4-4-4-4" />
      <path d="M19.5 12h-11" />
    </template>
  </svg>
</template>
