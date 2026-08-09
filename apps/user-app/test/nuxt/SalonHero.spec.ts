import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SalonHero from '../../app/components/salon/SalonHero.vue'

const PHOTOS = [
  { id: 'p1', url: 'http://cdn.example/p1.jpg' },
  { id: 'p2', url: 'http://cdn.example/p2.jpg' },
  { id: 'p3', url: 'http://cdn.example/p3.jpg' },
]

const BASE_PROPS = {
  photos: PHOTOS,
  fallbackPhoto: null,
  salonName: 'سالن نمونه',
  isFavorited: false,
  favoriteBusy: false,
}

describe('SalonHero', () => {
  beforeEach(() => {
    document.documentElement.style.overflow = ''
    document.body.style.overflow = ''
  })

  it('shows the shared placeholder when there are no photos and no fallback', async () => {
    const wrapper = await mountSuspended(SalonHero, { props: { ...BASE_PROPS, photos: [] } })
    expect(wrapper.find('[data-testid="salon-image-placeholder"]').exists()).toBe(true)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('falls back to the portfolio cover when the salon has no gallery photos', async () => {
    const wrapper = await mountSuspended(SalonHero, {
      props: { ...BASE_PROPS, photos: [], fallbackPhoto: 'http://cdn.example/fallback.jpg' },
    })
    expect(wrapper.find('[data-testid="salon-image-placeholder"]').exists()).toBe(false)
    expect(wrapper.get('img').attributes('src')).toContain('fallback.jpg')
  })

  it('shows the first photo as the hero image, loaded eagerly (not lazy) since it is the LCP candidate', async () => {
    const wrapper = await mountSuspended(SalonHero, { props: BASE_PROPS })
    const img = wrapper.get('img')
    expect(img.attributes('src')).toContain('p1.jpg')
    expect(img.attributes('loading')).not.toBe('lazy')
  })

  it('shows a photo-count badge only when there is more than one photo', async () => {
    const single = await mountSuspended(SalonHero, { props: { ...BASE_PROPS, photos: [PHOTOS[0]!] } })
    expect(single.text()).not.toContain('۳')

    const multiple = await mountSuspended(SalonHero, { props: BASE_PROPS })
    expect(multiple.text()).toContain('۳')
  })

  it('reflects the favorited state via aria-pressed and emits toggle-favorite on click', async () => {
    const wrapper = await mountSuspended(SalonHero, { props: BASE_PROPS })
    const button = wrapper.get('[data-testid="favorite-button"]')
    expect(button.attributes('aria-pressed')).toBe('false')

    await button.trigger('click')
    expect(wrapper.emitted('toggle-favorite')).toHaveLength(1)
  })

  it('disables the favorite button while a toggle request is in flight', async () => {
    const wrapper = await mountSuspended(SalonHero, { props: { ...BASE_PROPS, favoriteBusy: true } })
    expect(wrapper.get('[data-testid="favorite-button"]').attributes('disabled')).toBeDefined()
  })

  it('opens the lightbox on tapping the hero photo, showing a 1-based counter', async () => {
    const wrapper = await mountSuspended(SalonHero, { props: BASE_PROPS })
    await wrapper.get('[data-testid="salon-hero-photo"]').trigger('click')

    const lightbox = wrapper.get('[data-testid="salon-hero-lightbox"]')
    expect(lightbox.text()).toContain('۱')
    expect(lightbox.text()).toContain('۳')
  })

  it('wraps around in both directions when paging through the lightbox', async () => {
    const wrapper = await mountSuspended(SalonHero, { props: BASE_PROPS })
    await wrapper.get('[data-testid="salon-hero-photo"]').trigger('click')

    // "next" wraps from the last photo back to the first.
    await wrapper.get('[data-testid="salon-hero-lightbox-next"]').trigger('click')
    await wrapper.get('[data-testid="salon-hero-lightbox-next"]').trigger('click')
    expect(wrapper.get('[data-testid="salon-hero-lightbox"]').get('img').attributes('src')).toContain('p3.jpg')
    await wrapper.get('[data-testid="salon-hero-lightbox-next"]').trigger('click')
    expect(wrapper.get('[data-testid="salon-hero-lightbox"]').get('img').attributes('src')).toContain('p1.jpg')

    // "prev" from the first photo wraps to the last.
    await wrapper.get('[data-testid="salon-hero-lightbox-prev"]').trigger('click')
    expect(wrapper.get('[data-testid="salon-hero-lightbox"]').get('img').attributes('src')).toContain('p3.jpg')
  })

  it('closes the lightbox via its close button', async () => {
    const wrapper = await mountSuspended(SalonHero, { props: BASE_PROPS })
    await wrapper.get('[data-testid="salon-hero-photo"]').trigger('click')
    await wrapper.get('[data-testid="salon-hero-lightbox-close"]').trigger('click')

    expect(wrapper.find('[data-testid="salon-hero-lightbox"]').exists()).toBe(false)
  })

  it('renders whatever the page passes into the #corner slot (the story ring)', async () => {
    const wrapper = await mountSuspended(SalonHero, {
      props: BASE_PROPS,
      slots: { corner: '<button data-testid="fake-story-ring">استوری</button>' },
    })
    expect(wrapper.find('[data-testid="fake-story-ring"]').exists()).toBe(true)
  })
})
