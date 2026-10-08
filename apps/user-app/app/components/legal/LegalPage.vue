<script setup lang="ts">
import { LEGAL_DOCUMENTS, type LegalDocument } from '../../content/legal'
import { resolveLegalDocument, type BookingTermsValues } from '../../utils/legal-render'
import { buildCanonicalUrl } from '../../utils/canonical-url'
import { formatDateShort } from '../../utils/format-date'

const props = defineProps<{ slug: LegalDocument['slug'] }>()

const source = LEGAL_DOCUMENTS[props.slug]
const config = useRuntimeConfig()
const { flags } = useFeatureFlags()
const { apiFetch } = useApi()

// The policy numbers are live platform config. A failed fetch yields null, which drops the
// blocks that quote them -- a legal page must never show a number we could not confirm.
const { data: terms } = await useAsyncData('legal-booking-terms', async () => {
  const { data } = await apiFetch<BookingTermsValues>('/platform-config/booking-terms', {
    silent: true,
    redirectOn401: false,
  })
  return data
})

const doc = computed(() =>
  resolveLegalDocument(source, {
    paymentsOn: flags.value.onlinePaymentEnabled,
    terms: terms.value ?? null,
    operator: {
      name: config.public.legalName,
      email: config.public.legalEmail,
      phone: config.public.legalPhone,
      address: config.public.legalAddress,
      registration: config.public.legalRegistration,
    },
  }),
)

const canonicalUrl = buildCanonicalUrl(config.public.siteUrl, `/${props.slug}`)
useSeoMeta({
  title: source.title,
  description: source.description,
  ogTitle: source.title,
  ogDescription: source.description,
  ogUrl: canonicalUrl,
  twitterCard: 'summary',
})
useHead({ link: [{ rel: 'canonical', href: canonicalUrl }] })

const updated = formatDateShort(source.updatedAt)
</script>

<template>
  <article data-legal-page class="mx-auto max-w-2xl px-4 py-8 lg:max-w-3xl lg:py-12">
    <header class="space-y-3">
      <h1 class="text-2xl font-bold leading-10 text-(--color-text)">{{ doc.title }}</h1>
      <p v-if="updated" class="text-sm text-(--color-text-muted)">
        آخرین به‌روزرسانی: <time :datetime="source.updatedAt">{{ updated }}</time>
      </p>
      <p v-if="doc.intro" class="text-base leading-8 text-(--color-text)">{{ doc.intro }}</p>
    </header>

    <nav v-if="doc.sections.length > 1" aria-label="فهرست مطالب" class="mt-6 print:hidden">
      <details class="rounded-xl border border-(--color-border) bg-(--color-surface-card)">
        <summary class="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold text-(--color-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent-text)">
          فهرست مطالب
        </summary>
        <ol class="space-y-0.5 px-4 pb-3 text-sm">
          <li v-for="section in doc.sections" :key="section.id">
            <a
              :href="`#${section.id}`"
              class="flex min-h-11 items-center gap-1.5 text-(--color-text-muted) hover:text-(--color-text) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-accent-text)"
            >
              <span class="tnum">{{ section.number }}.</span>
              <span>{{ section.title }}</span>
            </a>
          </li>
        </ol>
      </details>
    </nav>

    <div class="mt-8 space-y-10">
      <section
        v-for="section in doc.sections"
        :key="section.id"
        :aria-labelledby="section.id"
        class="space-y-4"
      >
        <h2 :id="section.id" class="scroll-mt-20 text-xl font-bold leading-9 text-(--color-text)">
          <span class="tnum">{{ section.number }}.</span> {{ section.title }}
        </h2>
        <template v-for="(block, i) in section.blocks" :key="i">
          <p v-if="block.type === 'p'" class="text-base leading-8 text-(--color-text)">{{ block.text }}</p>
          <ul v-else-if="block.type === 'ul'" class="list-disc space-y-2 ps-6 text-base leading-8 text-(--color-text)">
            <li v-for="item in block.items" :key="item">{{ item }}</li>
          </ul>
          <p
            v-else
            data-testid="legal-note"
            class="rounded-e-xl border-s-4 border-(--color-accent-deep) bg-(--color-surface-subtle) px-4 py-3 text-base leading-8 text-(--color-text)"
          >
            {{ block.text }}
          </p>
        </template>
      </section>
    </div>
  </article>
</template>
