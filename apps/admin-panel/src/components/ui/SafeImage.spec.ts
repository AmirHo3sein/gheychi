import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SafeImage from './SafeImage.vue'

describe('SafeImage', () => {
  it('renders the image with its alt text', () => {
    const wrapper = mount(SafeImage, { props: { src: 'http://x/a.jpg', alt: 'تصویر ۱' } })
    expect(wrapper.get('img').attributes('src')).toBe('http://x/a.jpg')
    expect(wrapper.get('img').attributes('alt')).toBe('تصویر ۱')
  })

  it('swaps to a labelled fallback when the image fails to load', async () => {
    const wrapper = mount(SafeImage, { props: { src: 'http://x/broken.jpg', alt: 'تصویر ۱' } })
    await wrapper.get('img').trigger('error')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('[data-testid="image-fallback"]').attributes('aria-label')).toContain('بارگذاری نشد')
  })

  it('retries when given a new src after a failure', async () => {
    const wrapper = mount(SafeImage, { props: { src: 'http://x/broken.jpg', alt: 'a' } })
    await wrapper.get('img').trigger('error')
    await wrapper.setProps({ src: 'http://x/ok.jpg' })
    expect(wrapper.find('img').exists()).toBe(true)
  })
})
