import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import BottomNav from './BottomNav.vue'
import { NAV_TABS, isTabActive } from './nav-tabs'

const route = { path: '/' }

vi.mock('vue-router', () => ({
  useRoute: () => route,
}))

function mountNav(path: string) {
  route.path = path
  return mount(BottomNav, {
    global: { stubs: { RouterLink: { template: '<a :class="$attrs.class"><slot /></a>' } } },
  })
}

describe('isTabActive', () => {
  it('matches the dashboard only on an exact "/"', () => {
    expect(isTabActive('/', '/')).toBe(true)
    expect(isTabActive('/', '/bookings')).toBe(false)
  })

  it('matches a section on its own path and on nested paths', () => {
    expect(isTabActive('/bookings', '/bookings')).toBe(true)
    expect(isTabActive('/bookings', '/bookings/b1')).toBe(true)
    // Not a prefix match on a sibling route that merely starts with the same string.
    expect(isTabActive('/service', '/services')).toBe(false)
  })
})

describe('BottomNav', () => {
  it('renders every primary destination', () => {
    const wrapper = mountNav('/')

    expect(wrapper.findAll('a')).toHaveLength(NAV_TABS.length)
  })

  // Layout regression, iOS. The bar is `fixed bottom-0`; without the safe-area inset its
  // bottom row (label + active indicator) renders underneath the home indicator.
  it('pads itself for the iOS home-indicator inset', () => {
    expect(mountNav('/').get('nav').classes()).toContain('pb-[env(safe-area-inset-bottom)]')
  })

  // A phone bottom bar spanning a 1280px+ screen is the wrong shape for the desktop/tablet
  // setup session PRODUCT.md treats as equally real -- from lg the same destinations render
  // inline in the header instead (AppLayout.vue), so exactly one of the two is ever visible.
  it('hides itself from lg up, where the header carries the same tabs', () => {
    expect(mountNav('/').get('nav').classes()).toContain('lg:hidden')
  })

  // 320px / 5 tabs leaves 64px each; a label must truncate rather than widen the bar.
  it('constrains each tab so a label cannot force the bar wider than the viewport', () => {
    const link = mountNav('/').get('a')

    expect(link.classes()).toContain('min-w-0')
    expect(link.get('span').classes()).toContain('truncate')
  })
})
