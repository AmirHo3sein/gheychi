<template>
  <!-- Exists primarily as a site-wide internal-link block, not decoration. Every public
       surface of this app (home, salon profiles, blog articles) renders inside the default
       layout, so putting the browse listing here means every server-rendered page carries a
       link into the salon catalogue -- previously only the sitemap did, and a page reachable
       solely from a sitemap arrives with none of the internal-link context that tells a
       search engine it matters.

       Kept to the genuinely public destinations: an authenticated route linked from every
       page would just be a redirect-to-login for a crawler, and robots.txt disallows those
       paths anyway (server/utils/robots.ts). -->
  <footer class="mt-8 border-t border-(--color-border) bg-(--color-surface-card)">
    <div class="mx-auto max-w-2xl space-y-3 p-4 lg:max-w-5xl lg:p-6">
      <nav class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" aria-label="ناوبری فوتر">
        <NuxtLink to="/" class="text-(--color-text-muted) transition-colors hover:text-(--color-text)">خانه</NuxtLink>
        <NuxtLink to="/salons" class="text-(--color-text-muted) transition-colors hover:text-(--color-text)">سالن‌های زیبایی</NuxtLink>
        <!-- Both gender facets linked explicitly: `gender` is a required /search param with no
             anonymous default, so a crawler that only ever saw /salons would index the
             women's listing and never discover a single men's salon. -->
        <NuxtLink to="/salons?gender=men" class="text-(--color-text-muted) transition-colors hover:text-(--color-text)">سالن‌های مردانه</NuxtLink>
        <NuxtLink to="/blog" class="text-(--color-text-muted) transition-colors hover:text-(--color-text)">بلاگ</NuxtLink>
      </nav>
      <!-- Deliberately no rendered "current year": it would be computed independently on the
           server and in the browser, which is a hydration mismatch waiting on a locale/ICU
           difference or a midnight rollover for no reader benefit. -->
      <p class="text-xs text-(--color-text-muted)">قیچی — رزرو آنلاین نوبت سالن‌های زیبایی</p>
    </div>
  </footer>
</template>
