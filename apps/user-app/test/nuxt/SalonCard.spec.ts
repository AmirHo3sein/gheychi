import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SalonCard from '../../app/components/salon/SalonCard.vue'

const baseSalon = {
  id: '1', name: 'Test Salon', slug: 'test-salon', city: 'Tehran', address: 'addr',
  ratingAvg: 4.5, ratingCount: 10, distanceKm: 1.2, minPrice: 300000, coverPhoto: null,
  isFeatured: false, hasActiveStory: false, categories: [],
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

  it('shows the scissors placeholder icon instead of a bare box when there is no cover photo', async () => {
    const wrapper = await mountSuspended(SalonCard, { props: { salon: baseSalon } })
    expect(wrapper.find('[data-testid="salon-image-placeholder"]').exists()).toBe(true)
  })

  it('does not show the placeholder icon when a cover photo is set', async () => {
    const wrapper = await mountSuspended(SalonCard, {
      props: { salon: { ...baseSalon, coverPhoto: 'http://cdn.example/c.jpg' } },
    })
    expect(wrapper.find('[data-testid="salon-image-placeholder"]').exists()).toBe(false)
  })

  it('shows a badge per category, up to a two-badge cap plus a +N overflow count', async () => {
    const wrapper = await mountSuspended(SalonCard, {
      props: {
        salon: {
          ...baseSalon,
          categories: [
            { id: 1, name: 'کوتاهی مو', icon: 'scissors' },
            { id: 2, name: 'رنگ مو', icon: 'palette' },
            { id: 3, name: 'ناخن', icon: 'nail' },
          ],
        },
      },
    })
    expect(wrapper.text()).toContain('کوتاهی مو')
    expect(wrapper.text()).toContain('رنگ مو')
    expect(wrapper.text()).not.toContain('ناخن')
    expect(wrapper.text()).toContain('+۱')
  })

  it('shows no category badges when the salon has none', async () => {
    const wrapper = await mountSuspended(SalonCard, { props: { salon: baseSalon } })
    expect(wrapper.text()).not.toContain('+')
  })
})
