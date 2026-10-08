import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import LegalPage from '../../app/components/legal/LegalPage.vue'

// Tiny fixture of the content module's shape -- the real copy is authored elsewhere and
// must not be able to break these behaviour tests.
vi.mock('../../app/content/legal', () => ({
  LEGAL_DOCUMENTS: {
    terms: {
      slug: 'terms',
      title: 'شرایط آزمایشی',
      description: 'توضیح آزمایشی',
      updatedAt: '2026-10-08',
      intro: 'مقدمه آزمایشی',
      sections: [
        {
          id: 'deposit',
          title: 'بیعانه',
          blocks: [
            { type: 'p', text: 'بیعانه {{depositPercent}} درصد است.' },
            { type: 'note', text: 'یادداشت مهم' },
            { type: 'p', text: 'پرداخت آنلاین فعال است.', when: 'paymentsOn' },
          ],
        },
        { id: 'contact', title: 'تماس', blocks: [{ type: 'p', text: 'تلفن: {{operatorPhone}}' }] },
        { id: 'last', title: 'پایانی', blocks: [{ type: 'ul', items: ['الف', 'ب'] }] },
      ],
    },
  },
}))

const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), { create: () => fetchStub })
const TERMS = { depositPercent: 20, depositMinToman: 50000, cancellationWindowHours: 24 }

function flags(onlinePaymentEnabled: boolean) {
  useState('feature-flags').value = {
    reviewsEnabled: true,
    storiesEnabled: true,
    portfolioEnabled: true,
    referralsEnabled: true,
    couponsEnabled: true,
    onlinePaymentEnabled,
    beautyGuideEnabled: false,
  }
}

describe('LegalPage', () => {
  let wrapper: Awaited<ReturnType<typeof mountSuspended>> | undefined

  beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/platform-config/booking-terms') return TERMS
      throw new Error(`unexpected fetch path in test: ${path}`)
    })
    vi.stubGlobal('$fetch', fetchStub)
    wrapper?.unmount()
    wrapper = undefined
    clearNuxtData('legal-booking-terms')
    flags(false)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders h1, a fa-IR update date, numbered h2 sections with stable ids, and live numbers', async () => {
    wrapper = await mountSuspended(LegalPage, { props: { slug: 'terms' } })

    expect(wrapper.get('h1').text()).toBe('شرایط آزمایشی')
    expect(wrapper.text()).toContain('آخرین به‌روزرسانی')
    expect(wrapper.get('time').text()).toBe('۱۶ مهر ۱۴۰۵')
    const h2s = wrapper.findAll('h2')
    expect(h2s.map((h: { attributes: (k: string) => string | undefined }) => h.attributes('id'))).toEqual(['deposit', 'last'])
    expect(h2s[0]!.text()).toBe(`${(1).toLocaleString('fa-IR')}. بیعانه`)
    expect(wrapper.text()).toContain(`بیعانه ${(20).toLocaleString('fa-IR')} درصد است.`)
  })

  it('builds a collapsible table of contents whose anchors match the section ids', async () => {
    wrapper = await mountSuspended(LegalPage, { props: { slug: 'terms' } })

    const nav = wrapper.get('nav[aria-label="فهرست مطالب"]')
    expect(nav.find('details').exists()).toBe(true)
    expect(nav.findAll('a').map((a: { attributes: (k: string) => string | undefined }) => a.attributes('href'))).toEqual(['#deposit', '#last'])
    expect(nav.classes()).toContain('print:hidden')
  })

  it('renders a note as a callout and keeps unset-operator blocks out of the page', async () => {
    wrapper = await mountSuspended(LegalPage, { props: { slug: 'terms' } })

    expect(wrapper.get('[data-testid="legal-note"]').text()).toBe('یادداشت مهم')
    expect(wrapper.text()).not.toContain('تلفن:')
    expect(wrapper.text()).not.toContain('{{')
    expect(wrapper.text()).not.toContain('تماس')
  })

  it('switches `when` blocks on feature_online_payment_enabled', async () => {
    wrapper = await mountSuspended(LegalPage, { props: { slug: 'terms' } })
    expect(wrapper.text()).not.toContain('پرداخت آنلاین فعال است')

    wrapper.unmount()
    flags(true)
    wrapper = await mountSuspended(LegalPage, { props: { slug: 'terms' } })
    expect(wrapper.text()).toContain('پرداخت آنلاین فعال است')
  })

  it('degrades gracefully when booking-terms cannot be fetched: numeric blocks vanish, the page still renders', async () => {
    fetchMock.mockImplementation(async () => {
      throw { response: { status: 500 }, statusMessage: 'boom' }
    })
    wrapper = await mountSuspended(LegalPage, { props: { slug: 'terms' } })
    await flushPromises()

    expect(wrapper.get('h1').text()).toBe('شرایط آزمایشی')
    expect(wrapper.text()).not.toContain('درصد')
    expect(wrapper.text()).not.toContain('{{')
    expect(wrapper.text()).toContain('الف')
  })

  it('sets the title, description and an absolute canonical for indexing', async () => {
    wrapper = await mountSuspended(LegalPage, { props: { slug: 'terms' } })

    await vi.waitFor(() => {
      expect(document.head.querySelector('meta[name="description"]')?.getAttribute('content')).toBe('توضیح آزمایشی')
    })
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toMatch(/^https?:\/\/.+\/terms$/)
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '').not.toContain('noindex')
  })
})
