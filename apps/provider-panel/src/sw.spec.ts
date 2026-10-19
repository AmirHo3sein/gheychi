// The provider panel's service worker (public/sw.js) is plain JS served as-is, so it is run
// here against a fake worker global rather than imported.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// vitest runs from the package root (happy-dom rewrites import.meta.url, so it can't anchor this).
const source = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')

type Listener = (event: Record<string, unknown>) => void

function boot(windows: Array<{ url: string; focus: ReturnType<typeof vi.fn>; navigate: ReturnType<typeof vi.fn> }> = []) {
  const listeners: Record<string, Listener> = {}
  const self = {
    location: { origin: 'https://panel.gheychi.co' },
    registration: { showNotification: vi.fn().mockResolvedValue(undefined) },
    clients: { claim: vi.fn(), matchAll: vi.fn().mockResolvedValue(windows), openWindow: vi.fn().mockResolvedValue(undefined) },
    skipWaiting: vi.fn(),
    addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
  }
  new Function('self', source)(self)
  return { self, listeners }
}

async function fire(listener: Listener, event: Record<string, unknown>) {
  let pending: Promise<unknown> = Promise.resolve()
  listener({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) })
  await pending
}

describe('provider service worker', () => {
  let sw: ReturnType<typeof boot>
  beforeEach(() => {
    sw = boot()
  })

  it('shows the API payload as an RTL Persian notification, one per booking', async () => {
    const payload = { title: 'درخواست نوبت جدید', body: 'سالن — فردا', data: { type: 'salon-booking', bookingId: 'b1' } }
    await fire(sw.listeners.push!, { data: { json: () => payload } })
    expect(sw.self.registration.showNotification).toHaveBeenCalledWith('درخواست نوبت جدید', expect.objectContaining({ body: 'سالن — فردا', dir: 'rtl', lang: 'fa', tag: 'booking-b1', renotify: true, data: payload.data }))
  })

  it('still shows a notification for an empty or malformed push', async () => {
    await fire(sw.listeners.push!, { data: { json: () => { throw new Error('bad') } } })
    expect(sw.self.registration.showNotification).toHaveBeenCalledWith('اعلان جدید از قیچی', expect.objectContaining({ body: '' }))
  })

  it('opens the bookings screen for a salon-booking click, reusing an open panel tab', async () => {
    const tab = { url: 'https://panel.gheychi.co/services', focus: vi.fn().mockResolvedValue(undefined), navigate: vi.fn().mockResolvedValue(undefined) }
    sw = boot([tab])
    const close = vi.fn()
    await fire(sw.listeners.notificationclick!, { notification: { close, data: { type: 'salon-booking', bookingId: 'b1' } } })
    expect(close).toHaveBeenCalled()
    expect(tab.focus).toHaveBeenCalled()
    expect(tab.navigate).toHaveBeenCalledWith('https://panel.gheychi.co/bookings')
    expect(sw.self.clients.openWindow).not.toHaveBeenCalled()
  })

  it('opens a new window when none is open, and never follows a URL from the payload', async () => {
    await fire(sw.listeners.notificationclick!, { notification: { close: vi.fn(), data: { type: 'evil', url: 'https://evil.example' } } })
    expect(sw.self.clients.openWindow).toHaveBeenCalledWith('https://panel.gheychi.co/')
  })
})
