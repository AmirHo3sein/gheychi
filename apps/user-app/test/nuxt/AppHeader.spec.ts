import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AppHeader from '../../app/components/layout/AppHeader.vue'
import { useSessionStore } from '../../app/stores/session'

const USER = { id: 'u1', phone: '09120000000', name: 'Test', gender: 'female' as const, role: 'customer' as const }

describe('AppHeader', () => {
  beforeEach(() => {
    useSessionStore().$reset()
  })

  it('shows the account links only once logged in', async () => {
    const anonymous = await mountSuspended(AppHeader)
    expect(anonymous.text()).not.toContain('نوبت‌های من')

    useSessionStore().setUser(USER)
    const loggedIn = await mountSuspended(AppHeader)
    expect(loggedIn.text()).toContain('نوبت‌های من')
    expect(loggedIn.text()).toContain('پروفایل')
  })

  // Layout regression guard, not styling taste. This header renders on every page, so it
  // is the single widest-blast-radius overflow risk in the app. At 320px (PRODUCT.md's
  // hard floor: budget Android) a logged-in header needs roughly 355px -- logo, two text
  // links, and a three-way theme toggle that is a fixed ~112px and can neither shrink nor
  // break -- against a 288px content box. Without wrapping it overflows, and in RTL that
  // escapes to the LEFT, off the readable edge. happy-dom has no layout engine, so the
  // property that makes the overflow impossible is pinned by class instead.
  it('wraps rather than overflowing when the logged-in nav is wider than the viewport', async () => {
    useSessionStore().setUser(USER)
    const wrapper = await mountSuspended(AppHeader)

    expect(wrapper.get('header').classes()).toContain('flex-wrap')
    // The nav itself must wrap too: the toggle alone is unbreakable, so if the nav were a
    // single non-wrapping row it could still overflow once it has a line to itself.
    expect(wrapper.get('nav').classes()).toContain('flex-wrap')
  })
})
