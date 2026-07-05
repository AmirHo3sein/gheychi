import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'

// `$fetch` is exposed by Nuxt as a real `globalThis` binding (set up by a build-time
// plugin), not as an unimport-tracked auto-import -- so `mockNuxtImport` can't target
// it (it only knows about names in the live unimport registry, and errors with
// "Cannot find import ... to mock" for anything else). `vi.stubGlobal` is the
// documented way to stub it instead.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

// `mockNuxtImport` compiles to a hoisted `vi.mock` call, so the mock it returns must
// come from `vi.hoisted` -- a plain `const` here would be accessed before its
// initialization once vitest lifts the mock above this file's other statements.
const { navigateToMock } = vi.hoisted(() => ({ navigateToMock: vi.fn() }))
mockNuxtImport('navigateTo', () => navigateToMock)

describe('useApi', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    navigateToMock.mockReset()
    // Re-stub before every test (and undo it in afterEach below) rather than stubbing
    // once at module scope, so this file doesn't rely on Vitest's default per-file
    // isolation to keep the global stub from leaking across tests/files.
    vi.stubGlobal('$fetch', fetchStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns { data } on success', async () => {
    fetchMock.mockResolvedValue({ id: '1' })
    const { apiFetch } = useApi()
    const result = await apiFetch('/salons/foo')
    expect(result).toEqual({ data: { id: '1' }, error: null })
  })

  it('in silent mode, returns the error instead of throwing or redirecting', async () => {
    fetchMock.mockRejectedValue({ response: { status: 409 }, statusMessage: 'Conflict' })
    const { apiFetch } = useApi()
    const result = await apiFetch('/bookings', { method: 'POST', silent: true })
    expect(result.data).toBeNull()
    expect(result.error?.status).toBe(409)
    expect(navigateToMock).not.toHaveBeenCalled()
  })

  it('on a 401, redirects to /login even when not silent', async () => {
    fetchMock.mockRejectedValue({ response: { status: 401 } })
    const { apiFetch } = useApi()
    await apiFetch('/bookings/mine')
    expect(navigateToMock).toHaveBeenCalledWith('/login')
  })

  it('on a 401 with redirectOn401: false, does not redirect but still returns the error', async () => {
    fetchMock.mockRejectedValue({ response: { status: 401 } })
    const { apiFetch } = useApi()
    const result = await apiFetch('/auth/me', { silent: true, redirectOn401: false })
    expect(navigateToMock).not.toHaveBeenCalled()
    expect(result.data).toBeNull()
    expect(result.error?.status).toBe(401)
  })

  it('on a non-401 error without silent mode, pushes a toast and still returns the error', async () => {
    fetchMock.mockRejectedValue({ response: { status: 500 }, statusMessage: 'Server error' })
    const { apiFetch } = useApi()
    const { toasts } = useToast()
    const before = toasts.value.length
    const result = await apiFetch('/search')
    expect(toasts.value.length).toBe(before + 1)
    expect(result.error?.status).toBe(500)
  })
})
