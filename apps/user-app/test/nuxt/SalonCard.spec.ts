import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SalonCard from '../../app/components/salon/SalonCard.vue'

const baseSalon = {
  id: '1', name: 'Test Salon', slug: 'test-salon', city: 'Tehran', address: 'addr',
  ratingAvg: 4.5, ratingCount: 10, distanceKm: 1.2, minPrice: 300000, coverPhoto: null,
  isFeatured: false,
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
})
