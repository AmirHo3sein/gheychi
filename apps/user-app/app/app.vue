<script setup lang="ts">
useSeoMeta({
  titleTemplate: (title) => (title ? `${title} | قیچی` : 'قیچی — رزرو آنلاین نوبت سالن زیبایی'),
  ogSiteName: 'قیچی',
  // Sitewide fallbacks -- any page's own useSeoMeta call (e.g. blog/[slug].vue's
  // ogType: 'article') registers after this root component's setup and overrides these
  // per Nuxt/unhead's standard parent-then-child merge order, so this only fills the gap
  // for pages that don't set their own value.
  ogType: 'website',
  twitterCard: 'summary',
})
</script>

<template>
  <NuxtRouteAnnouncer />
  <!--
    Injects <link rel="manifest"> into the document head. @vite-pwa/nuxt does not add this
    automatically -- without it, manifest.webmanifest is generated and served correctly but
    is never linked from the page, so the browser has no manifest to evaluate for
    installability (Chrome DevTools' Application > Manifest panel would show nothing).
  -->
  <VitePwaManifest />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <ToastStack />
</template>
