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

  it('fills exactly as many stars as the review\'s rating, and no more', async () => {
    const wrapper = await mountSuspended(SalonReviews, { props: { reviews: [reviews[1]!], canReport: false } }) // rating: 2
    // Scoped to the star row itself (found via its own aria-label), not a raw global
    // svg index -- the section heading carries its own (unrelated, muted) star icon too.
    const ratingStars = wrapper.get('[aria-label*="ستاره"]').findAll('svg')
    expect(ratingStars).toHaveLength(5)
    expect(ratingStars.filter((s) => s.classes().includes('text-(--color-accent-text)'))).toHaveLength(2)
    expect(ratingStars.filter((s) => s.classes().includes('text-(--color-border)'))).toHaveLength(3)
  })

  it('gives the star row an accessible label stating the numeric rating', async () => {
    const wrapper = await mountSuspended(SalonReviews, { props: { reviews: [reviews[0]!], canReport: false } }) // rating: 5
    expect(wrapper.find('[aria-label*="ستاره"]').attributes('aria-label')).toContain('۵')
  })

  it('shows a relative time next to each review', async () => {
    const wrapper = await mountSuspended(SalonReviews, { props: { reviews: [reviews[0]!], canReport: false } })
    // Not asserting the exact string (that's relative-date.spec.ts's job) -- just that
    // createdAt actually reaches the rendered card, which it did not before this redesign.
    expect(wrapper.text()).toMatch(/پیش|دیروز|گذشته|همین دقیقه/)
  })
})
