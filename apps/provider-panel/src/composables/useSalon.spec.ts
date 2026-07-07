import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetSalon, useSalon } from './useSalon'

describe('useSalon', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sets salon to the fetched value on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 's1', status: 'pending' }),
    }))

    const { salon, checked, refetch } = useSalon()
    await refetch()

    expect(checked.value).toBe(true)
    expect(salon.value).toEqual({ id: 's1', status: 'pending' })
  })

  it('sets salon to null when the caller has no salon yet (404)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ message: 'No salon for this account' }),
    }))

    const { salon, refetch } = useSalon()
    await refetch()

    expect(salon.value).toBeNull()
  })

  it('resetSalon clears state back to its initial values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 's1', status: 'pending' }),
    }))

    const { salon, checked, refetch } = useSalon()
    await refetch()
    expect(checked.value).toBe(true)
    expect(salon.value).not.toBeNull()

    resetSalon()

    expect(checked.value).toBe(false)
    expect(salon.value).toBeNull()
  })
})
