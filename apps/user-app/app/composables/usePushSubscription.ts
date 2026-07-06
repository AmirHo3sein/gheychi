// NOTE: deviates from the plan's `Uint8Array.from([...raw].map(...))` -- on this project's
// TypeScript/DOM lib version, `Uint8Array.from` types its result as `Uint8Array<ArrayBufferLike>`,
// which is not assignable to `PushSubscriptionOptionsInit.applicationServerKey` (`BufferSource`,
// which excludes `SharedArrayBuffer`-backed views) and fails `nuxt typecheck`. Allocating via
// `new Uint8Array(length)` instead yields an `ArrayBuffer`-backed typed array and produces the
// identical bytes.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i)
  return output
}

export function usePushSubscription() {
  const { apiFetch } = useApi()
  const config = useRuntimeConfig()
  const isSubscribed = ref(false)
  const supported = import.meta.client && 'serviceWorker' in navigator && 'PushManager' in window

  async function refreshStatus() {
    if (!supported) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    isSubscribed.value = !!sub
  }

  async function subscribe() {
    if (!supported) return
    const reg = await navigator.serviceWorker.ready
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.public.vapidPublicKey),
    })
    const json = sub.toJSON()
    await apiFetch('/push/subscribe', {
      method: 'POST',
      body: { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    })
    isSubscribed.value = true
  }

  async function unsubscribe() {
    if (!supported) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await apiFetch('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } })
      await sub.unsubscribe()
    }
    isSubscribed.value = false
  }

  return { supported, isSubscribed, refreshStatus, subscribe, unsubscribe }
}
