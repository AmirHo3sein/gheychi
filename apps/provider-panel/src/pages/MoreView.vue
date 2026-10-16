<!-- apps/provider-panel/src/pages/MoreView.vue -->
<!-- The sixth bottom-nav destination: every screen the phone bar has no room for, in the same
     groups the desktop sidebar uses (nav-config.ts), so the two never disagree about where a
     screen lives. On lg+ the sidebar already lists all of these; the page still works there
     for anyone who lands on /more directly. -->
<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { MORE_GROUPS } from '@/components/layout/nav-config'
</script>

<template>
  <div class="mx-auto w-full max-w-2xl space-y-6 p-4 lg:p-8">
    <h1 class="text-lg font-bold text-(--color-text)">بیشتر</h1>

    <section v-for="group in MORE_GROUPS" :key="group.key" :aria-labelledby="`more-${group.key}`">
      <h2 :id="`more-${group.key}`" class="mb-2 px-1 text-xs font-semibold text-(--color-text-muted)">{{ group.label }}</h2>
      <ul class="divide-y divide-(--color-border-soft) overflow-hidden rounded-2xl border border-(--color-border) bg-(--color-surface-card) shadow-(--shadow-sm)">
        <li v-for="link in group.items" :key="link.to">
          <RouterLink
            :to="link.to"
            :data-testid="`more-link-${link.to.slice(1)}`"
            class="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-(--color-border-soft)"
          >
            <span class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-(--color-surface-subtle) text-(--color-accent-text-strong)">
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
