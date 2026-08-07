import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import StoriesRing from '../../app/components/salon/StoriesRing.vue'

describe('StoriesRing', () => {
  it('shows the shared placeholder (sparkles icon, not a bare box) when there is no cover photo', async () => {
    const wrapper = await mountSuspended(StoriesRing, {
      props: { stories: [], coverPhoto: null, lastSeen: null },
    })
    expect(wrapper.find('[data-testid="salon-image-placeholder"]').exists()).toBe(true)
  })

  it('does not show the placeholder when a cover photo is set', async () => {
    const wrapper = await mountSuspended(StoriesRing, {
      props: { stories: [], coverPhoto: 'http://cdn.example/c.jpg', lastSeen: null },
    })
    expect(wrapper.find('[data-testid="salon-image-placeholder"]').exists()).toBe(false)
  })
})
