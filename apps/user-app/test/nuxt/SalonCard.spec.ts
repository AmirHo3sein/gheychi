import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SalonCard from '../../app/components/salon/SalonCard.vue'

const baseSalon = {
  id: '1', name: 'Test Salon', slug: 'test-salon', city: 'Tehran', address: 'addr',
  ratingAvg: 4.5, ratingCount: 10, distanceKm: 1.2, minPrice: 300000, coverPhoto: null,
  isFeatured: false, hasActiveStory: false,
}

describe('SalonCard', () => {
  it('does not show the Ad badge for a non-featured salon', async () => {
    const wrapper = await mountSuspended(SalonCard, { props: { salon: baseSalon } })
    expect(wrapper.find('[data-testid="ad-badge"]').exists()).toBe(false)
  })

  it('shows the Ad badge for a featured salon', async () => {
    const wrapper = await mountSuspended(SalonCard, { props: { salon: { ...baseSalon, isFeatured: true } } })
    expect(wrapper.find('[data-testid="ad-badge"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('تبلیغ')
  })

  it('links to the salon profile by slug', async () => {
    const wrapper = await mountSuspended(SalonCard, { props: { salon: baseSalon } })
    expect(wrapper.find('a').attributes('href')).toBe('/salons/test-salon')
  })

  it('shows no story ring around the thumbnail without an active story', async () => {
    const wrapper = await mountSuspended(SalonCard, {
      props: { salon: { ...baseSalon, coverPhoto: 'http://cdn.example/c.jpg' } },
    })
    expect(wrapper.get('[data-testid="salon-thumb"]').classes()).not.toContain('ring-2')
  })

  it('rings the thumbnail with the accent color when the salon has an active story', async () => {
    const wrapper = await mountSuspended(SalonCard, {
      props: { salon: { ...baseSalon, coverPhoto: 'http://cdn.example/c.jpg', hasActiveStory: true } },
    })
    const classes = wrapper.get('[data-testid="salon-thumb"]').classes()
    expect(classes).toContain('ring-2')
    expect(classes).toContain('ring-(--color-accent)')
  })

  it('rings the placeholder thumbnail too when there is no cover photo', async () => {
    const wrapper = await mountSuspended(SalonCard, {
      props: { salon: { ...baseSalon, hasActiveStory: true } },
    })
    expect(wrapper.get('[data-testid="salon-thumb"]').classes()).toContain('ring-2')
  })
})
