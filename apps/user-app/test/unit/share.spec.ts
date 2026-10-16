import { describe, it, expect, vi } from 'vitest'
import { salonShareUrl, shareLink } from '../../app/utils/share'

const payload = { title: 'سالن نمونه', url: 'https://gheychi.co/salons/nemune?source=direct' }

function abortError(): Error {
  const e = new Error('dismissed')
  e.name = 'AbortError'
  return e
}

describe('shareLink', () => {
  it('uses the native share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    expect(await shareLink(payload, { share, clipboard: { writeText } })).toBe('shared')
    expect(share).toHaveBeenCalledWith(payload)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('treats a dismissed share sheet as cancelled, without copying behind the customer\'s back', async () => {
    const writeText = vi.fn()
    const outcome = await shareLink(payload, { share: vi.fn().mockRejectedValue(abortError()), clipboard: { writeText } })
    expect(outcome).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to copying the link when share() is refused for another reason', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const notAllowed = Object.assign(new Error('no'), { name: 'NotAllowedError' })
    expect(await shareLink(payload, { share: vi.fn().mockRejectedValue(notAllowed), clipboard: { writeText } })).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(payload.url)
  })

  it('skips share() when canShare says the payload is not shareable', async () => {
    const share = vi.fn()
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await shareLink(payload, { share, canShare: () => false, clipboard: { writeText } })).toBe('copied')
    expect(share).not.toHaveBeenCalled()
  })

  it('copies the link on a desktop without a share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    expect(await shareLink(payload, { clipboard: { writeText } })).toBe('copied')
  })

  it('reports unavailable when neither path works', async () => {
    expect(await shareLink(payload, {})).toBe('unavailable')
    expect(await shareLink(payload, undefined)).toBe('unavailable')
    expect(await shareLink(payload, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } })).toBe('unavailable')
  })
})

describe('salonShareUrl', () => {
  it('builds the public link with the direct-share attribution', () => {
    expect(salonShareUrl('https://gheychi.co/', 'nemune.salon')).toBe('https://gheychi.co/salons/nemune.salon?source=direct')
  })
})
