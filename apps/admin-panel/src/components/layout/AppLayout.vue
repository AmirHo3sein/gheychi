<!-- apps/admin-panel/src/components/layout/AppLayout.vue -->
<script setup lang="ts"></script>

<template>
  <div class="flex">
    <SidebarNav />
    <main class="flex-1"><RouterView /></main>
  </div>
</template>

<script lang="ts">
import SidebarNav from './SidebarNav.vue'
export default { components: { SidebarNav } }
</script>
