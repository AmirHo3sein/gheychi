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

  // A failed FIRST probe must not look like a settled "no salon": the router guard only
  // re-probes while `checked` is false, so flipping it here would trap an owner whose
  // /salons/mine happened to 5xx once in onboarding for the rest of the tab's session.
  it('does not mark the probe as checked when the very first fetch fails with a non-404', async () => {
    resetSalon()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Internal server error' }),
    }))

    const { salon, checked, refetch } = useSalon()
    const { error } = await refetch()

    expect(error).toEqual({ status: 500, message: 'Internal server error' })
    expect(salon.value).toBeNull()
    expect(checked.value).toBe(false)
  })

  it('leaves salon unchanged on a non-404 error (e.g. a transient 500)', async () => {
    resetSalon()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 's1', status: 'approved' }),
    }))
    const { salon, refetch } = useSalon()
    await refetch()
    expect(salon.value).toEqual({ id: 's1', status: 'approved' })

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: 'Internal server error' }),
    }))
    await refetch()

    expect(salon.value).toEqual({ id: 's1', status: 'approved' })
  })
})
