import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiFetch = vi.fn()
vi.mock('@/composables/useApi', () => ({ useApi: () => ({ apiFetch }) }))
const toast = vi.fn()
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ push: toast }) }))

// A real-looking base64url P-256 public key (65 bytes); the value itself is never verified here.
const VAPID = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'

function fakeSubscription(endpoint = 'https://push.example/device-1') {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn().mockResolvedValue(true),
  }
}

function installBrowser(opts: { permission?: NotificationPermission; requestResult?: NotificationPermission; existing?: ReturnType<typeof fakeSubscription> | null; subscribeThrows?: boolean } = {}) {
  let current = opts.existing ?? null
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => {
      if (opts.subscribeThrows) throw new Error('no push service')
      current = fakeSubscription()
      return current
    }),
  }
  const reg = { pushManager }
  let registered = !!opts.existing
  const serviceWorker = {
    getRegistration: vi.fn(async () => (registered ? reg : undefined)),
    register: vi.fn(async () => {
      registered = true
      return reg
    }),
    ready: Promise.resolve(reg),
  }
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true })
  vi.stubGlobal('PushManager', function PushManager() {})
  const Notification = Object.assign(function Notification() {}, {
    permission: opts.permission ?? 'default',
    requestPermission: vi.fn(async () => opts.requestResult ?? 'granted'),
  })
  vi.stubGlobal('Notification', Notification)
  return { serviceWorker, pushManager, current: () => current }
}

async function load(vapid = VAPID) {
  vi.resetModules()
  vi.stubEnv('VITE_VAPID_PUBLIC_KEY', vapid)
  return import('./usePushNotifications')
}

describe('usePushNotifications', () => {
  beforeEach(() => {
    apiFetch.mockReset().mockResolvedValue({ data: { ok: true }, error: null })
    toast.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    // @ts-expect-error -- test cleanup of the stubbed property
    delete navigator.serviceWorker
  })

  it('reports an unsupported browser, a missing VAPID key and a blocked permission honestly', async () => {
    let { usePushNotifications } = await load()
    let p = usePushNotifications()
    await p.refresh()
    expect(p.state.value).toBe('unsupported')

    installBrowser()
    ;({ usePushNotifications } = await load(''))
    p = usePushNotifications()
    await p.refresh()
    expect(p.state.value).toBe('unconfigured')

    installBrowser({ permission: 'denied' })
    ;({ usePushNotifications } = await load())
    p = usePushNotifications()
    await p.refresh()
    expect(p.state.value).toBe('denied')
    expect(apiFetch).not.toHaveBeenCalled()
  })

  it('reads "on" only after the server re-binds an existing subscription to this account', async () => {
    installBrowser({ existing: fakeSubscription() })
    const { usePushNotifications } = await load()
    const p = usePushNotifications()
    await p.refresh()
    expect(apiFetch).toHaveBeenCalledWith('/push/subscribe', expect.objectContaining({ method: 'POST', body: expect.objectContaining({ audience: 'provider' }), silent: true }))
    expect(p.state.value).toBe('on')

    apiFetch.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'x' } })
    await p.refresh()
    expect(p.state.value).toBe('off')
  })

  it('enables: asks permission, registers /sw.js, subscribes with the VAPID key and posts audience provider', async () => {
    const browser = installBrowser()
    const { usePushNotifications } = await load()
    const p = usePushNotifications()
    await p.enable()
    expect(browser.serviceWorker.register).toHaveBeenCalledWith('/sw.js', { scope: '/' })
    expect(browser.pushManager.subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }))
    expect(apiFetch).toHaveBeenCalledWith(
      '/push/subscribe',
      expect.objectContaining({ method: 'POST', body: { endpoint: 'https://push.example/device-1', p256dh: 'p', auth: 'a', audience: 'provider' } }),
    )
    expect(p.state.value).toBe('on')
  })

  it('rolls the browser subscription back when the server refuses it', async () => {
    const browser = installBrowser()
    apiFetch.mockResolvedValueOnce({ data: null, error: { status: 500, message: 'x' } })
    const { usePushNotifications } = await load()
    const p = usePushNotifications()
    await p.enable()
    expect(browser.current()!.unsubscribe).toHaveBeenCalled()
    expect(p.state.value).toBe('off')
  })

  it('stays off without any request when permission is refused, and says so when subscribing fails', async () => {
    installBrowser({ requestResult: 'denied' })
    let { usePushNotifications } = await load()
    let p = usePushNotifications()
    await p.enable()
    expect(p.state.value).toBe('denied')
    expect(apiFetch).not.toHaveBeenCalled()

    installBrowser({ subscribeThrows: true })
    ;({ usePushNotifications } = await load())
    p = usePushNotifications()
    await p.enable()
    expect(p.state.value).toBe('off')
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('ممکن نشد'), 'error')
  })

  it('disables: deletes the server record, then the browser subscription', async () => {
    const sub = fakeSubscription()
    installBrowser({ existing: sub, permission: 'granted' })
    const { usePushNotifications } = await load()
    const p = usePushNotifications()
    await p.disable()
    expect(apiFetch).toHaveBeenCalledWith('/push/subscribe', expect.objectContaining({ method: 'DELETE', body: { endpoint: sub.endpoint } }))
    expect(sub.unsubscribe).toHaveBeenCalled()
    expect(p.state.value).toBe('off')
  })

  it('unbindPushBeforeLogout removes this device and never throws', async () => {
    const sub = fakeSubscription()
    installBrowser({ existing: sub })
    const { unbindPushBeforeLogout } = await load()
    await unbindPushBeforeLogout()
    expect(apiFetch).toHaveBeenCalledWith('/push/subscribe', expect.objectContaining({ method: 'DELETE', redirectOn401: false }))
    expect(sub.unsubscribe).toHaveBeenCalled()

    apiFetch.mockRejectedValueOnce(new Error('network'))
    installBrowser({ existing: fakeSubscription() })
    await expect(unbindPushBeforeLogout()).resolves.toBeUndefined()
  })
})
