<script setup lang="ts">
// The three legal documents as one link row. Used by the footer, the login screen and anywhere
// else the terms need to be one tap away; `label` names the surrounding nav landmark.
withDefaults(defineProps<{ label?: string }>(), { label: 'اسناد حقوقی' })

const links = [
  { to: '/terms', text: 'شرایط استفاده' },
  { to: '/privacy', text: 'حریم خصوصی' },
  { to: '/booking-policy', text: 'قوانین رزرو و لغو' },
]
</script>

<template>
  <nav :aria-label="label" data-testid="legal-links" class="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
    <NuxtLink
      v-for="link in links"
      :key="link.to"
      :to="link.to"
      class="inline-flex min-h-11 items-center rounded text-(--color-text-muted) transition-colors hover:text-(--color-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent-text)"
    >
      {{ link.text }}
    </NuxtLink>
  </nav>
</template>
