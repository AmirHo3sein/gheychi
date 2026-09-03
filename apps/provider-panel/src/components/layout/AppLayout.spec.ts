import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetSalon, useSalon } from '@/composables/useSalon'
import { useSessionStore } from '@/stores/session'
import AppLayout from './AppLayout.vue'

function makeRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: AppLayout, children: [{ path: '', name: 'dashboard', component: { template: '<div />' } }] },
      { path: '/login', name: 'login', component: { template: '<div />' } },
    ],
  })
}

describe('AppLayout logout', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetSalon()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // useSalon() is a module-level singleton that the router guard only re-probes while
  // `checked` is false. Leaving the previous owner's salon (and `checked: true`) behind on
  // logout would route the next account to log in on this tab on stale data.
  it('clears the session AND the salon singleton, then navigates to /login', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 204, json: async () => null }))
    useSessionStore().setUser({ id: 'u1', phone: '0912', name: 'Sara', gender: 'female', role: 'provider' })
    const { salon, checked } = useSalon()
    salon.value = {
      id: 's1',
      name: 'سالن سارا',
      slug: 'sara',
      status: 'approved',
      genderTarget: 'women',
      address: 'x',
      city: 'x',
      capacity: 1,
      rejectionReason: null,
    }
    checked.value = true

    const router = makeRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(AppLayout, { global: { plugins: [router] } })
    expect(wrapper.text()).toContain('سالن سارا')

    await wrapper.get('button[title="خروج"]').trigger('click')
    await new Promise((r) => setTimeout(r, 0))

    expect(useSessionStore().user).toBeNull()
    expect(salon.value).toBeNull()
    expect(checked.value).toBe(false)
    expect(router.currentRoute.value.name).toBe('login')
  })
})
