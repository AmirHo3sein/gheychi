import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import LegalLinks from '../../app/components/legal/LegalLinks.vue'
import AppFooter from '../../app/components/layout/AppFooter.vue'

describe('LegalLinks', () => {
  it('links the three legal documents inside a labelled nav landmark', async () => {
    const wrapper = await mountSuspended(LegalLinks)
    const nav = wrapper.get('nav')
    expect(nav.attributes('aria-label')).toBe('اسناد حقوقی')
    expect(wrapper.findAll('a').map((a) => [a.attributes('href'), a.text()])).toEqual([
      ['/terms', 'شرایط استفاده'],
      ['/privacy', 'حریم خصوصی'],
      ['/booking-policy', 'قوانین رزرو و لغو'],
    ])
  })

  it('gives every link a 44px touch target', async () => {
    const wrapper = await mountSuspended(LegalLinks)
    for (const a of wrapper.findAll('a')) expect(a.classes()).toContain('min-h-11')
  })
})

describe('AppFooter', () => {
  it('carries the legal links and is hidden when printing', async () => {
    const wrapper = await mountSuspended(AppFooter)
    expect(wrapper.find('[data-testid="legal-links"]').exists()).toBe(true)
    expect(wrapper.get('footer').classes()).toContain('print:hidden')
  })
})
