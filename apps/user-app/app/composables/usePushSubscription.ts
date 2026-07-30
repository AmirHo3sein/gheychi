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
  // Deviates from the plan's `import.meta.client && 'serviceWorker' in navigator && ...`
  // computed once at setup time: that expression is a build-time-constant `false` in the
  // server bundle (`import.meta.client` is statically false there), so this page -- which
  // is server-rendered, unlike a route with `ssr: false` -- would render the `v-if` toggle
  // section as absent during SSR and then have it pop in after client hydration flips
  // `supported` to `true`, a genuine hydration mismatch. `index.vue`'s
  // `import.meta.client && navigator.geolocation` check already avoids this by only ever
  // running inside `onMounted` (a client-only hook). Composables invoked synchronously from
  // a component's `<script setup>` (as `profile.vue` does here, before any `await`) may
  // call lifecycle hooks themselves, so detection is deferred into this composable's own
  // `onMounted` and exposed as a ref instead of a plain boolean.
  const supported = ref(false)

  onMounted(() => {
    supported.value = 'serviceWorker' in navigator && 'PushManager' in window
  })

  /**
   * Re-POSTs the browser's *existing* subscription so the push_subscriptions row for
   * this endpoint is owned by whoever is logged in RIGHT NOW. The browser's PushManager
   * is per-device, not per-user: on a shared device the row keeps `user_id` of whoever
   * subscribed first, so without this rebind user B would keep receiving user A's
   * appointment notifications, and B's own toggle-off (a DELETE scoped to
   * `{ endpoint, userId: B }`) would delete nothing. Idempotent -- POST /push/subscribe
   * updates `user_id` in place for an already-known endpoint.
   *
   * Returns whether the server acknowledged the (re)binding. Deliberately silent and
   * never redirect-on-401: this is background repair triggered by a page mount or a
   * fresh login, and must never toast at, or navigate, a user who didn't ask for it.
   */
  async function rebindOwnership(sub: PushSubscription): Promise<boolean> {
    const json = sub.toJSON()
    const { error } = await apiFetch('/push/subscribe', {
      method: 'POST',
      body: { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth },
      silent: true,
      redirectOn401: false,
    })
    return !error
  }

  /** Rebinds this browser's subscription (if any) to the current session. No-op if none. */
  async function rebindToCurrentUser() {
    if (!supported.value) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) await rebindOwnership(sub)
  }

  async function refreshStatus() {
    if (!supported.value) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    // A browser subscription alone is NOT proof that notifications reach *this* user --
    // it says nothing about which account the server has the endpoint filed under. So
    // rebind first and only claim "on" once the server acknowledged it; a failed rebind
    // reports "off", which is both honest (nothing will arrive for this account) and
    // recoverable -- tapping the toggle re-subscribes to the same endpoint and re-POSTs.
    isSubscribed.value = sub ? await rebindOwnership(sub) : false
  }

  async function subscribe() {
    if (!supported.value) return
    const reg = await navigator.serviceWorker.ready
    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return

    let sub: PushSubscription
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.public.vapidPublicKey),
      })
    } catch {
      // A misconfigured/empty vapidPublicKey (a real production-config mistake, not just
      // a hypothetical) makes the browser reject subscribe() with a DOMException before
      // apiFetch is ever reached -- without this, the toggle click would silently do
      // nothing after the permission prompt, with no feedback at all.
      useToast().push('فعال‌سازی اعلان‌ها با خطا مواجه شد')
      return
    }

    const json = sub.toJSON()
    // Not passed `silent: true`: apiFetch already shows its own toast on a non-401
    // failure here, so no need to raise a second one below -- only the browser-side
    // rollback is this function's own responsibility.
    const { error } = await apiFetch('/push/subscribe', {
      method: 'POST',
      body: { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth },
    })
    if (error) {
      // Without this rollback, the browser-side subscription would exist with no
      // matching backend record, and refreshStatus() -- which only ever asks the
      // browser's own pushManager.getSubscription() -- would report "subscribed"
      // forever, leaving the user stuck believing notifications work.
      await sub.unsubscribe()
      return
    }
    isSubscribed.value = true
  }

  async function unsubscribe() {
    if (!supported.value) return
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await apiFetch('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } })
      await sub.unsubscribe()
    }
    isSubscribed.value = false
  }

  return { supported, isSubscribed, refreshStatus, rebindToCurrentUser, subscribe, unsubscribe }
}
