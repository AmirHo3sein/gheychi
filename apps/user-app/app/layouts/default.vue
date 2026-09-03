<template>
  <!-- flex-col + flex-1 on <main> keeps the footer at the bottom of short pages rather than
       floating mid-viewport. -->
  <div class="min-h-screen flex flex-col">
    <AppHeader />
    <main class="flex-1">
      <slot />
    </main>
    <AppFooter />
  </div>
</template>
