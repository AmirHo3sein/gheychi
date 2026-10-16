<script setup lang="ts">
import { showsSiteFooter } from '../utils/route-guard'

// The phone tab bar is hidden where the screen already has a sticky primary action at the
// bottom edge: checkout (/booking/*) and a single salon's page (/salons/<slug>). Two fixed
// bars stacked there would crowd the CTA that the whole page exists to drive.
const route = useRoute()
const isSalonPage = computed(() => /^\/salons\/[^/]+$/.test(route.path))
const showBottomNav = computed(() => !(route.path.startsWith('/booking/') || isSalonPage.value))
// Marketing footer on public pages only -- see showsSiteFooter.
const showFooter = computed(() => showsSiteFooter(route.path))
// The salon page's fixed «مشاهده خدمات» bar (phones, below lg) sits where the tab bar would.
// Its height (p-4 around a 44px button, plus the border) is reserved here, on the layout, so
// the bar never covers the footer links -- page-level padding only ever reached the content
// above the footer. Reserved from the route alone so SSR and hydration agree; a salon with no
// priced service (no bar) just keeps a little blank space under the footer.
const bottomPadding = computed(() => {
  if (showBottomNav.value) return 'pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0'
  if (isSalonPage.value) return 'pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0'
  return ''
})
</script>

<template>
  <!-- flex-col + flex-1 on <main> keeps the footer at the bottom of short pages rather than
       floating mid-viewport. The bottom padding (phones only) reserves the tab bar's height so
       it never covers the last row of content or the footer links; the salon page's sticky CTA
       bar gets the same reservation (see bottomPadding). -->
  <div class="flex min-h-screen flex-col" :class="bottomPadding">
    <AppHeader />
    <main class="flex-1">
      <slot />
    </main>
    <AppFooter v-if="showFooter" />
    <BottomNav v-if="showBottomNav" />
  </div>
</template>
