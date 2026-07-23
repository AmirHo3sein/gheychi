import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import PortfolioGrid from '../../app/components/salon/PortfolioGrid.vue'

// Same pattern as ReportForm.spec.ts: `$fetch` is a real globalThis binding, stubbed
// directly -- the embedded ReportForm posts through it.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

const ITEMS = [
  { id: 'pf1', url: 'http://cdn.example/pf1.jpg', caption: 'رنگ مو', serviceId: 'svc1', sortOrder: 0 },
  { id: 'pf2', url: 'http://cdn.example/pf2.jpg', caption: null, serviceId: 'gone', sortOrder: 1 },
]

const SERVICES = [{ id: 'svc1', name: 'کوتاهی مو' }]

const BASE_PROPS = { items: ITEMS, services: SERVICES, slug: 'test-salon', salonId: 's1' }

const VALID_REASON = 'این تصویر محتوای نامناسبی دارد'

describe('PortfolioGrid', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
    // Earlier tests may leave a still-mounted grid with its lightbox open (mountSuspended
    // wrappers aren't auto-unmounted), whose scroll lock then pollutes the "prior" value
    // the next lock captures -- start every test from an unlocked document.
    document.documentElement.style.overflow = ''
    document.body.style.overflow = ''
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('renders a tile per item with its caption', async () => {
    const wrapper = await mountSuspended(PortfolioGrid, { props: BASE_PROPS })
    expect(wrapper.text()).toContain('نمونه کارها')
    expect(wrapper.findAll('[data-testid="portfolio-item"]')).toHaveLength(2)
    expect(wrapper.text()).toContain('رنگ مو')
    expect(wrapper.find('[data-testid="portfolio-lightbox"]').exists()).toBe(false)
  })

  it('opens the lightbox on tap and shows the booking pill for a matching service', async () => {
    const wrapper = await mountSuspended(PortfolioGrid, { props: BASE_PROPS })
    await wrapper.findAll('[data-testid="portfolio-item"]')[0]!.trigger('click')

    expect(wrapper.find('[data-testid="portfolio-lightbox"]').exists()).toBe(true)
    const pill = wrapper.get('[data-testid="portfolio-booking-pill"]')
    expect(pill.text()).toContain('رزرو این خدمت')
    expect(pill.attributes('href')).toBe('/booking/test-salon/svc1')
  })

  it('shows no booking pill when the serviceId matches none of the fetched services', async () => {
    const wrapper = await mountSuspended(PortfolioGrid, { props: BASE_PROPS })
    await wrapper.findAll('[data-testid="portfolio-item"]')[1]!.trigger('click')

    expect(wrapper.find('[data-testid="portfolio-lightbox"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="portfolio-booking-pill"]').exists()).toBe(false)
  })

  it('closes the lightbox via its close button', async () => {
    const wrapper = await mountSuspended(PortfolioGrid, { props: BASE_PROPS })
    await wrapper.findAll('[data-testid="portfolio-item"]')[0]!.trigger('click')
    await wrapper.get('[data-testid="portfolio-lightbox-close"]').trigger('click')

    expect(wrapper.find('[data-testid="portfolio-lightbox"]').exists()).toBe(false)
  })

  it('locks background scroll while the lightbox is open and restores the prior value on close', async () => {
    document.documentElement.style.overflow = 'scroll'
    try {
      const wrapper = await mountSuspended(PortfolioGrid, { props: BASE_PROPS })
      await wrapper.findAll('[data-testid="portfolio-item"]')[0]!.trigger('click')

      expect(document.documentElement.style.overflow).toBe('hidden')
      expect(document.body.style.overflow).toBe('hidden')

      await wrapper.get('[data-testid="portfolio-lightbox-close"]').trigger('click')
      expect(document.documentElement.style.overflow).toBe('scroll')
      expect(document.body.style.overflow).toBe('')
    } finally {
      document.documentElement.style.overflow = ''
      document.body.style.overflow = ''
    }
  })

  it('restores background scroll when unmounted with the lightbox still open', async () => {
    const wrapper = await mountSuspended(PortfolioGrid, { props: BASE_PROPS })
    await wrapper.findAll('[data-testid="portfolio-item"]')[0]!.trigger('click')
    expect(document.documentElement.style.overflow).toBe('hidden')

    wrapper.unmount()
    expect(document.documentElement.style.overflow).toBe('')
    expect(document.body.style.overflow).toBe('')
  })

  it('hides the report affordance when the viewer is not report-eligible', async () => {
    const wrapper = await mountSuspended(PortfolioGrid, { props: BASE_PROPS })
    await wrapper.findAll('[data-testid="portfolio-item"]')[0]!.trigger('click')

    expect(wrapper.find('[data-testid="portfolio-report-button"]').exists()).toBe(false)
  })

  it('reports the open item: the form POSTs a portfolioItemId-targeted body', async () => {
    fetchMock.mockResolvedValue({ id: 'rep1' })
    const wrapper = await mountSuspended(PortfolioGrid, {
      props: { ...BASE_PROPS, canReport: true },
    })
    await wrapper.findAll('[data-testid="portfolio-item"]')[0]!.trigger('click')
    await wrapper.get('[data-testid="portfolio-report-button"]').trigger('click')

    await wrapper.get('[data-testid="report-reason-input"]').setValue(VALID_REASON)
    await wrapper.get('[data-testid="submit-report-button"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      '/reports',
      expect.objectContaining({
        method: 'POST',
        body: { portfolioItemId: 'pf1', reason: VALID_REASON },
      }),
    )
    // ReportForm emitted close on success -- the form is gone, the lightbox remains.
    expect(wrapper.find('[data-testid="report-reason-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="portfolio-lightbox"]').exists()).toBe(true)
  })

  it('exposes dialog semantics on the lightbox: role=dialog, aria-modal, aria-labelledby', async () => {
    const wrapper = await mountSuspended(PortfolioGrid, { props: BASE_PROPS })
    await wrapper.findAll('[data-testid="portfolio-item"]')[0]!.trigger('click')

    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('aria-modal')).toBe('true')
    const labelledBy = dialog.attributes('aria-labelledby')
    expect(labelledBy).toBeTruthy()
    expect(dialog.get('h2').attributes('id')).toBe(labelledBy)
  })

  it('moves focus into the lightbox on open and restores it to the trigger on close', async () => {
    const wrapper = await mountSuspended(PortfolioGrid, { props: BASE_PROPS, attachTo: document.body })
    const trigger = wrapper.findAll('[data-testid="portfolio-item"]')[0]!
    ;(trigger.element as HTMLElement).focus()
    await trigger.trigger('click')
    await nextTick()

    // Booking pill (link) is the first focusable element inside the lightbox panel.
    expect(document.activeElement).toBe(wrapper.get('[data-testid="portfolio-booking-pill"]').element)

    await wrapper.get('[data-testid="portfolio-lightbox-close"]').trigger('click')
    expect(document.activeElement).toBe(trigger.element)
  })

  it('closes the lightbox on Escape (previously a no-op bug)', async () => {
    const wrapper = await mountSuspended(PortfolioGrid, { props: BASE_PROPS })
    await wrapper.findAll('[data-testid="portfolio-item"]')[0]!.trigger('click')
    expect(wrapper.find('[data-testid="portfolio-lightbox"]').exists()).toBe(true)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()

    expect(wrapper.find('[data-testid="portfolio-lightbox"]').exists()).toBe(false)
  })

  it('suspends the lightbox Escape handling while the nested report dialog is open', async () => {
    fetchMock.mockResolvedValue({ id: 'rep1' })
    const wrapper = await mountSuspended(PortfolioGrid, { props: { ...BASE_PROPS, canReport: true } })
    await wrapper.findAll('[data-testid="portfolio-item"]')[0]!.trigger('click')
    await wrapper.get('[data-testid="portfolio-report-button"]').trigger('click')
    await nextTick()

    // Escape now belongs to ReportForm's own dialog -- it closes the form, not the lightbox.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await nextTick()

    expect(wrapper.find('[data-testid="report-reason-input"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="portfolio-lightbox"]').exists()).toBe(true)
  })
})
