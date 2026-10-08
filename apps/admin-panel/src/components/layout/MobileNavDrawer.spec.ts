import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'

const currentPath = ref('/')
vi.mock('vue-router', () => ({
  useRoute: () => ({
    get path() { return currentPath.value },
    get fullPath() { return currentPath.value },
  }),
}))

const { default: MobileNavDrawer } = await import('./MobileNavDrawer.vue')

function mountDrawer(open = true) {
  return mount(MobileNavDrawer, {
    attachTo: document.body,
    props: { modelValue: open, 'onUpdate:modelValue': (v: boolean) => wrapper.setProps({ modelValue: v }) },
    global: { stubs: { RouterLink: LinkStub } },
  })
}
// RouterLinkStub renders an href-less <a>, which a real browser would not make tabbable.
const LinkStub = { props: ['to'], template: '<a :href="to" @click.prevent><slot /></a>' }
let wrapper: ReturnType<typeof mountDrawer>

afterEach(() => {
  wrapper?.unmount()
  document.body.style.overflow = ''
  currentPath.value = '/'
})

describe('MobileNavDrawer', () => {
  it('renders nothing while closed', () => {
    wrapper = mountDrawer(false)
    expect(wrapper.find('[data-testid="mobile-nav-drawer"]').exists()).toBe(false)
    expect(document.body.style.overflow).toBe('')
  })

  it('shows the labelled navigation with its section headings in a modal dialog', async () => {
    wrapper = mountDrawer(false)
    await wrapper.setProps({ modelValue: true })
    await nextTick()
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-label')).toBe('منو')
    expect(dialog.attributes('id')).toBe('mobile-nav-drawer')
    expect(dialog.text()).toContain('مالی')
    expect(dialog.text()).toContain('تنظیمات پلتفرم')
  })

  it('locks body scroll while open and restores it on close', async () => {
    wrapper = mountDrawer(false)
    await wrapper.setProps({ modelValue: true })
    expect(document.body.style.overflow).toBe('hidden')
    await wrapper.setProps({ modelValue: false })
    expect(document.body.style.overflow).toBe('')
  })

  it('moves focus into the panel when it opens', async () => {
    wrapper = mountDrawer(false)
    await wrapper.setProps({ modelValue: true })
    await nextTick()
    await nextTick()
    expect(document.activeElement?.getAttribute('aria-label')).toBe('بستن منو')
  })

  it('closes on Escape, on the backdrop and on the close button', async () => {
    wrapper = mountDrawer(true)
    await wrapper.get('[data-testid="mobile-nav-drawer"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('update:modelValue')?.at(-1)).toEqual([false])

    await wrapper.setProps({ modelValue: true })
    await wrapper.get('[data-testid="drawer-backdrop"]').trigger('click')
    expect(wrapper.props('modelValue')).toBe(false)

    await wrapper.setProps({ modelValue: true })
    await wrapper.get('[data-drawer-close]').trigger('click')
    expect(wrapper.props('modelValue')).toBe(false)
  })

  it('closes when a link is chosen and when the route changes', async () => {
    wrapper = mountDrawer(true)
    await wrapper.get('nav a').trigger('click')
    expect(wrapper.props('modelValue')).toBe(false)

    await wrapper.setProps({ modelValue: true })
    currentPath.value = '/salons'
    await nextTick()
    expect(wrapper.props('modelValue')).toBe(false)
  })

  it('traps Tab inside the panel', async () => {
    wrapper = mountDrawer(true)
    await nextTick()
    const focusables = wrapper.get('[role="dialog"]').findAll('a, button')
    const first = focusables[0]!.element as HTMLElement
    const last = focusables[focusables.length - 1]!.element as HTMLElement

    last.focus()
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(first)

    first.focus()
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
  })
})
