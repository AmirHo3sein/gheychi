import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import BaseInput from '../../app/components/ui/BaseInput.vue'

describe('BaseInput focus treatment', () => {
  it('uses a 2px accent-text focus-visible ring (>=3:1) instead of the 30% peach ring, and keeps the border change', async () => {
    const wrapper = await mountSuspended(BaseInput, { props: { label: 'نام' } })
    const classes = wrapper.get('input').classes()
    expect(classes).toContain('focus-visible:ring-2')
    expect(classes).toContain('focus-visible:ring-(--color-accent-text)')
    expect(classes).toContain('focus:border-(--color-accent-text)')
    expect(classes.join(' ')).not.toContain('/30')
  })

  it('keeps the danger border while invalid', async () => {
    const wrapper = await mountSuspended(BaseInput, { props: { label: 'نام', error: 'الزامی است' } })
    expect(wrapper.get('input').classes()).toContain('border-(--color-danger)')
  })
})
