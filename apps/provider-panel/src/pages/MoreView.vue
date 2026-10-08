<!-- apps/provider-panel/src/pages/MoreView.vue -->
<!-- The sixth bottom-nav destination: a plain grouped list of every screen the bar has no
     room for, so none of them is reachable only through the dashboard's tile grid. -->
<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { SECTION_GROUPS, SECTION_LINKS } from '@/utils/section-links'
</script>

<template>
  <div class="mx-auto w-full max-w-2xl space-y-6 p-4 lg:p-6">
    <h1 class="text-lg font-bold text-(--color-text)">بیشتر</h1>

    <section v-for="group in SECTION_GROUPS" :key="group.key" :aria-labelledby="`more-${group.key}`">
      <h2 :id="`more-${group.key}`" class="mb-2 text-xs font-bold text-(--color-text-muted)">{{ group.label }}</h2>
      <ul class="divide-y divide-(--color-border-soft) overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-sm)">
        <li v-for="link in SECTION_LINKS.filter((l) => l.group === group.key)" :key="link.to">
          <RouterLink
            :to="link.to"
            :data-testid="`more-link-${link.to.slice(1)}`"
            class="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-(--color-border-soft)"
          >
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--tone-info-bg) text-(--color-text-muted)">
              <AppIcon :name="link.icon" :size="18" />
            </span>
            <span class="min-w-0 flex-1 text-sm font-semibold text-(--color-text)">{{ link.label }}</span>
            <AppIcon name="chevron-left" :size="18" class="shrink-0 text-(--color-text-muted)" />
          </RouterLink>
        </li>
      </ul>
    </section>
  </div>
</template>
