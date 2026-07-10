import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SalonReviews from '../../app/components/salon/SalonReviews.vue'

const reviews = [
  { id: 'r1', rating: 5, comment: 'عالی بود', salonReply: null, createdAt: '2026-07-01T10:00:00Z' },
  { id: 'r2', rating: 2, comment: 'راضی نبودم', salonReply: 'متاسفیم، جبران می‌کنیم', createdAt: '2026-07-02T10:00:00Z' },
]

describe('SalonReviews', () => {
  it('renders the empty state when there are no reviews', async () => {
    const wrapper = await mountSuspended(SalonReviews, { props: { reviews: [], canReport: false } })
    expect(wrapper.text()).toContain('هنوز نظری ثبت نشده است')
  })

  it('renders reviews and salon replies', async () => {
    const wrapper = await mountSuspended(SalonReviews, { props: { reviews, canReport: false } })
    expect(wrapper.text()).toContain('عالی بود')
    expect(wrapper.text()).toContain('پاسخ سالن: متاسفیم، جبران می‌کنیم')
  })

  it('hides flag buttons when the viewer cannot report', async () => {
    const wrapper = await mountSuspended(SalonReviews, { props: { reviews, canReport: false } })
    expect(wrapper.findAll('[data-testid="flag-review-button"]')).toHaveLength(0)
  })

  it('shows one flag button per review when the viewer can report', async () => {
    const wrapper = await mountSuspended(SalonReviews, { props: { reviews, canReport: true } })
    expect(wrapper.findAll('[data-testid="flag-review-button"]')).toHaveLength(2)
  })

  it('emits report with the review id when a flag is clicked', async () => {
    const wrapper = await mountSuspended(SalonReviews, { props: { reviews, canReport: true } })

    await wrapper.findAll('[data-testid="flag-review-button"]')[1]!.trigger('click')

    expect(wrapper.emitted('report')).toHaveLength(1)
    expect(wrapper.emitted('report')![0]).toEqual(['r2'])
  })
})
