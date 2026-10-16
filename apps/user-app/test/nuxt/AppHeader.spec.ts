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

  // Intentional change (2026-10 redesign): logout used to be a one-tap icon in this bar on
  // every screen. It now lives only on the profile page (see profile.spec.ts), so the header
  // must never offer it, logged in or not.
  it('never carries a logout control -- that lives on the profile page', async () => {
    useSessionStore().setUser(USER)
    const loggedIn = await mountSuspended(AppHeader)
    expect(loggedIn.find('[data-testid="header-logout"]').exists()).toBe(false)
    expect(loggedIn.find('[aria-label="خروج از حساب"]').exists()).toBe(false)
  })

  it('carries the قیچی brand lockup (face mark + wordmark) linking home', async () => {
    const wrapper = await mountSuspended(AppHeader)
    const brand = wrapper.get('[data-testid="header-brand"]')
    expect(brand.attributes('href')).toBe('/')
    expect(brand.find('img[src="/brand-icon.png"]').exists()).toBe(true)
    expect(brand.text()).toBe('قیچی')
    // The 36px mark alone was a sub-40px tap target on phones.
    expect(brand.classes()).toContain('min-h-11')
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

})
