import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { usePushSubscription } from '../../app/composables/usePushSubscription'

// Same pattern as useApi.spec.ts / SlotPicker.spec.ts: `useApi` wraps the real `$fetch`
// global rather than being an unimport-tracked auto-import composable of its own, so the
// established way to control its behavior in a test is to stub `$fetch` directly.
const fetchMock = vi.fn()
const fetchStub = Object.assign((...args: unknown[]) => fetchMock(...args), {
  create: () => fetchStub,
})

// usePushSubscription() must run inside a mounted component instance -- it calls
// onMounted() itself (see the composable's own comment on why) -- so a minimal host
// component stands in for `profile.vue` to exercise it via mountSuspended.
const TestHost = defineComponent({
  setup() {
    return usePushSubscription()
  },
  template: '<div></div>',
})

// happy-dom's `navigator` has no `serviceWorker`/`PushManager` by default, which is
// exactly the "unsupported" branch -- the supported-branch tests add them back per-test
// and this restores the clean slate afterwards.
function stubSupportedBrowser() {
  const getSubscription = vi.fn().mockResolvedValue(null)
  const subscribe = vi.fn()
  const registration = { pushManager: { subscribe, getSubscription } }
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve(registration) },
    configurable: true,
  })
  vi.stubGlobal('PushManager', class {})
  vi.stubGlobal('Notification', { requestPermission: vi.fn().mockResolvedValue('granted') })
  return { subscribe, getSubscription }
}

describe('usePushSubscription', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('$fetch', fetchStub)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    // @ts-expect-error -- test-only cleanup of a property defined directly on navigator
    delete navigator.serviceWorker
  })

  it('treats an unsupported browser as a safe no-op for subscribe/unsubscribe/refreshStatus', async () => {
    const wrapper = await mountSuspended(TestHost)
    await nextTick()
    expect(wrapper.vm.supported).toBe(false)

    await wrapper.vm.refreshStatus()
    await wrapper.vm.subscribe()
    await wrapper.vm.unsubscribe()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(wrapper.vm.isSubscribed).toBe(false)
  })

  it('rolls back the browser-side subscription and leaves isSubscribed false when the backend POST fails', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(undefined)
    const { subscribe } = stubSupportedBrowser()
    subscribe.mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe,
    })
    fetchMock.mockRejectedValue({ response: { status: 500 }, statusMessage: 'Server error' })

    const wrapper = await mountSuspended(TestHost)
    await nextTick()
    expect(wrapper.vm.supported).toBe(true)

    await wrapper.vm.subscribe()

    expect(subscribe).toHaveBeenCalled()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(wrapper.vm.isSubscribed).toBe(false)
  })

  it('sets isSubscribed to true only once the backend POST succeeds', async () => {
    const unsubscribe = vi.fn()
    const { subscribe } = stubSupportedBrowser()
    subscribe.mockResolvedValue({
      toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe,
    })
    fetchMock.mockResolvedValue({ ok: true })

    const wrapper = await mountSuspended(TestHost)
    await nextTick()

    await wrapper.vm.subscribe()

    expect(unsubscribe).not.toHaveBeenCalled()
    expect(wrapper.vm.isSubscribed).toBe(true)
  })
})
