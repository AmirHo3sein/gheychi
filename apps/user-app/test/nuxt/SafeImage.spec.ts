import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import SafeImage from '../../app/components/ui/SafeImage.vue'

const props = { src: 'http://cdn.example/a.jpg', alt: 'سالن ستاره', width: 300, height: 300 }

describe('SafeImage', () => {
  it('renders the image with the caller\'s classes while it loads', async () => {
    const wrapper = await mountSuspended(SafeImage, { props, attrs: { class: 'h-20 w-20 rounded-xl object-cover' } })
    const img = wrapper.get('img')
    expect(img.attributes('alt')).toBe('سالن ستاره')
    expect(img.classes()).toContain('rounded-xl')
    expect(wrapper.find('[data-testid="salon-image-placeholder"]').exists()).toBe(false)
  })

  // A broken file used to leave the browser's broken-image glyph, raw alt text and a big empty
  // box on the salon page.
  it('degrades to the brand placeholder (same classes, still labelled) when the image fails to load', async () => {
    const wrapper = await mountSuspended(SafeImage, { props, attrs: { class: 'h-20 w-20 rounded-xl' } })
    await wrapper.get('img').trigger('error')

    expect(wrapper.find('img').exists()).toBe(false)
    const placeholder = wrapper.get('[data-testid="salon-image-placeholder"]')
    expect(placeholder.classes()).toContain('h-20')
    expect(placeholder.attributes('role')).toBe('img')
    expect(placeholder.attributes('aria-label')).toBe('سالن ستاره')
  })

  it('retries with a fresh attempt when given a new source (e.g. the next photo in a lightbox)', async () => {
    const wrapper = await mountSuspended(SafeImage, { props })
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)

    await wrapper.setProps({ src: 'http://cdn.example/b.jpg' })
    expect(wrapper.find('img').exists()).toBe(true)
  })
})
