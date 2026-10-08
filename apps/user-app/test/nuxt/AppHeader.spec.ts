import { describe, it, expect, beforeEach } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import AppHeader from '../../app/components/layout/AppHeader.vue'
import { useSessionStore } from '../../app/stores/session'

const USER = { id: 'u1', phone: '09120000000', name: 'Test', gender: 'female' as const, role: 'customer' as const }

describe('AppHeader', () => {
  beforeEach(() => {
    useSessionStore().$reset()
  })

  it('shows the account links and logout icon only once logged in', async () => {
    const anonymous = await mountSuspended(AppHeader)
    expect(anonymous.text()).not.toContain('نوبت‌های من')
    expect(anonymous.find('[data-testid="header-logout"]').exists()).toBe(false)

    useSessionStore().setUser(USER)
    const loggedIn = await mountSuspended(AppHeader)
    expect(loggedIn.text()).toContain('نوبت‌های من')
    expect(loggedIn.text()).toContain('پروفایل')
    expect(loggedIn.find('[data-testid="header-logout"]').exists()).toBe(true)
  })

  // The header used to wrap onto a second row below ~370px (logo on one line, two text links,
  // the theme toggle and logout under it) and spent ~110px of a phone screen before any
  // content. It is now ONE row at every width: the primary destinations moved to the phone tab
  // bar (BottomNav) and only appear in the header from `md` up. happy-dom has no layout
  // engine, so the properties that make a second row impossible are pinned by class.
  it('is a single row: nothing wraps, and the text nav only shows from md up', async () => {
    useSessionStore().setUser(USER)
    const wrapper = await mountSuspended(AppHeader)

    expect(wrapper.html()).not.toContain('flex-wrap')
    const nav = wrapper.get('nav[aria-label="ناوبری اصلی"]')
    expect(nav.classes()).toContain('hidden')
    expect(nav.classes()).toContain('md:flex')
  })

  // A logged-out visitor had no way to sign in from the chrome at all (login was reachable only
  // from a card on the home page).
  it('offers a sign-in button to a logged-out visitor, and only to them', async () => {
    const anonymous = await mountSuspended(AppHeader)
    const login = anonymous.get('[data-testid="header-login"]')
    expect(login.attributes('href')).toBe('/login')

    useSessionStore().setUser(USER)
    const loggedIn = await mountSuspended(AppHeader)
    expect(loggedIn.find('[data-testid="header-login"]').exists()).toBe(false)
  })

  it('labels the icon-only logout button for assistive tech (title alone is unreliable)', async () => {
    useSessionStore().setUser(USER)
    const wrapper = await mountSuspended(AppHeader)
    expect(wrapper.get('[data-testid="header-logout"]').attributes('aria-label')).toBe('خروج از حساب')
  })
})
