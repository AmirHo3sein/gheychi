import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory } from 'vue-router'
import { useSessionStore } from '@/stores/session'
import { createAppRouter } from './index'

const fetchMock = vi.fn()

vi.mock('@/composables/useApi', () => ({
  useApi: () => ({ apiFetch: fetchMock }),
}))

describe('admin-panel router guard', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    fetchMock.mockReset()
  })

  it('redirects an unauthenticated visitor to /login', async () => {
    fetchMock.mockResolvedValue({ data: null, error: { status: 401, message: 'unauthorized' } })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('login')
  })

  it('redirects a non-admin user to /forbidden', async () => {
    fetchMock.mockResolvedValue({
      data: { id: 'u1', phone: '0912', name: null, gender: null, role: 'customer' },
      error: null,
    })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('forbidden')
  })

  it('lets an admin user through to the dashboard', async () => {
    fetchMock.mockResolvedValue({
      data: { id: 'u1', phone: '0912', name: null, gender: null, role: 'admin' },
      error: null,
    })
    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })

  it('does not treat a transient network error as a confirmed logout', async () => {
    const session = useSessionStore()
    session.setUser({ id: 'u1', phone: '0912', name: null, gender: null, role: 'admin' })
    session.checked = false // force the guard to re-check despite already having a user
    fetchMock.mockResolvedValue({ data: null, error: { status: 0, message: 'Network error' } })

    const router = createAppRouter(createMemoryHistory())
    await router.push('/')
    await router.isReady()
    expect(router.currentRoute.value.name).toBe('dashboard')
  })
})
