<script setup lang="ts">
useSeoMeta({
  titleTemplate: (title) => (title ? `${title} | آرایشگاه` : 'آرایشگاه — رزرو آنلاین نوبت سالن زیبایی'),
  ogSiteName: 'آرایشگاه',
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
