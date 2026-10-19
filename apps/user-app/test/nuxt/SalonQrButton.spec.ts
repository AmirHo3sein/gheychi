import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import SalonQrButton from '../../app/components/salon/SalonQrButton.vue'

const toDataURL = vi.fn()
vi.mock('qrcode', () => ({ toDataURL: (...args: unknown[]) => toDataURL(...args) }))

enableAutoUnmount(afterEach)

const dialog = () => document.body.querySelector('[data-testid="salon-qr-dialog"]')

describe('SalonQrButton', () => {
  afterEach(() => {
    toDataURL.mockReset()
  })

  it('opens a dialog with a QR of the attributed salon link, downloadable as a PNG', async () => {
    toDataURL.mockResolvedValue('data:image/png;base64,QR')
    const wrapper = await mountSuspended(SalonQrButton, { props: { slug: 'nemune', salonName: 'سالن نمونه' } })
    expect(dialog()).toBeNull()

    await wrapper.get('[data-testid="salon-qr-button"]').trigger('click')
    await flushPromises()

    expect(toDataURL).toHaveBeenCalledWith(`${window.location.origin}/salons/nemune?source=qr`, expect.objectContaining({ color: { dark: '#2D2D2D', light: '#FFFFFF' } }))
    expect(dialog()?.getAttribute('role')).toBe('dialog')
    expect(dialog()?.textContent).toContain('سالن نمونه')
    expect(document.body.querySelector('[data-testid="salon-qr-image"]')?.getAttribute('src')).toBe('data:image/png;base64,QR')
    const download = document.body.querySelector('[data-testid="salon-qr-download"]')!
    expect(download.getAttribute('href')).toBe('data:image/png;base64,QR')
    expect(download.getAttribute('download')).toBe('qr-nemune.png')
  })

  it('closes on «بستن» and on Escape', async () => {
    toDataURL.mockResolvedValue('data:image/png;base64,QR')
    const wrapper = await mountSuspended(SalonQrButton, { props: { slug: 'nemune', salonName: 'x' } })
    await wrapper.get('[data-testid="salon-qr-button"]').trigger('click')
    await flushPromises()
    ;(document.body.querySelector('[data-testid="salon-qr-close"]') as HTMLButtonElement).click()
    await flushPromises()
    expect(dialog()).toBeNull()

    await wrapper.get('[data-testid="salon-qr-button"]').trigger('click')
    await flushPromises()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(dialog()).toBeNull()
  })

  it('says so and offers a retry when the code cannot be generated', async () => {
    toDataURL.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('data:image/png;base64,OK')
    const wrapper = await mountSuspended(SalonQrButton, { props: { slug: 'nemune', salonName: 'x' } })
    await wrapper.get('[data-testid="salon-qr-button"]').trigger('click')
    await flushPromises()
    expect(dialog()?.textContent).toContain('ساخت کد QR انجام نشد')
    expect(document.body.querySelector('[data-testid="salon-qr-download"]')).toBeNull()

    const retry = [...dialog()!.querySelectorAll('button')].find((b) => b.textContent?.includes('تلاش دوباره'))!
    retry.click()
    await flushPromises()
    expect(document.body.querySelector('[data-testid="salon-qr-image"]')).not.toBeNull()
  })
})
