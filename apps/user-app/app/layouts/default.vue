<script setup lang="ts">
// The phone tab bar is hidden where the screen already has a sticky primary action at the
// bottom edge: checkout (/booking/*) and a single salon's page (/salons/<slug>). Two fixed
// bars stacked there would crowd the CTA that the whole page exists to drive.
const route = useRoute()
const showBottomNav = computed(() => !(route.path.startsWith('/booking/') || /^\/salons\/[^/]+$/.test(route.path)))
</script>

<template>
  <!-- flex-col + flex-1 on <main> keeps the footer at the bottom of short pages rather than
       floating mid-viewport. The bottom padding (phones only) reserves the tab bar's height so
       it never covers the last row of content or the footer links. -->
  <div class="flex min-h-screen flex-col" :class="showBottomNav ? 'pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0' : ''">
    <AppHeader />
    <main class="flex-1">
      <slot />
    </main>
    <AppFooter />
    <BottomNav v-if="showBottomNav" />
  </div>
</template>
