<script setup lang="ts"></script>

<template>
  <div class="min-h-screen pb-16">
    <RouterView />
    <BottomNav />
  </div>
</template>

<script lang="ts">
import BottomNav from './BottomNav.vue'
export default { components: { BottomNav } }
</script>
