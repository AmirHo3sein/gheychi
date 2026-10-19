// Browser push for salon owners: «درخواست نوبت جدید» and friends even when the panel is closed.
//
// The API already sends owner notifications (payments.service.ts notifyOwner) to every push
// subscription this account registered with audience 'provider'; this composable is the panel's
// half: register /sw.js, ask permission, subscribe with the platform's VAPID key and POST the
// subscription (audience 'provider'). Mirrors the customer app's usePushSubscription, including
// its two hard-won rules:
//  - a browser subscription alone is not proof that THIS account receives anything (the
//    endpoint may be filed under whoever subscribed on this device before) -- so status is
//    only "on" after the server acknowledged a rebind;
//  - logout must unbind BEFORE the session is cleared (DELETE is scoped to the caller).
import { ref } from 'vue'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { buildEnv } from '@/utils/build-env'

const VAPID_PUBLIC_KEY = buildEnv(import.meta.env.VITE_VAPID_PUBLIC_KEY, '')
const SW_URL = '/sw.js'

export type PushState = 'unsupported' | 'unconfigured' | 'denied' | 'off' | 'on'

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

async function existingSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}

export function usePushNotifications() {
  const { apiFetch } = useApi()
  const state = ref<PushState>('off')
  const busy = ref(false)

  function baseState(): PushState | null {
    if (!isPushSupported()) return 'unsupported'
    if (!VAPID_PUBLIC_KEY) return 'unconfigured'
    if (Notification.permission === 'denied') return 'denied'
    return null
  }

  async function post(sub: PushSubscription, silent: boolean): Promise<boolean> {
    const json = sub.toJSON()
    const { error } = await apiFetch('/push/subscribe', {
      method: 'POST',
      body: { endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth, audience: 'provider' },
      silent,
      redirectOn401: !silent,
    })
    return !error
  }

  /** Reads the real state; rebinds an existing subscription to the account signed in now. */
  async function refresh() {
    const base = baseState()
    if (base) {
      state.value = base
      return
    }
    const sub = await existingSubscription()
    state.value = sub && (await post(sub, true)) ? 'on' : 'off'
  }

  async function enable() {
    if (baseState() || busy.value) return
    busy.value = true
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        state.value = permission === 'denied' ? 'denied' : 'off'
        return
      }
      const reg = (await navigator.serviceWorker.getRegistration('/')) ?? (await navigator.serviceWorker.register(SW_URL, { scope: '/' }))
      await navigator.serviceWorker.ready
      let sub: PushSubscription
      try {
        sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) }))
      } catch {
        useToast().push('فعال‌سازی اعلان‌ها در این مرورگر ممکن نشد.', 'error')
        state.value = 'off'
        return
      }
      if (!(await post(sub, false))) {
        // Never leave a browser subscription the server does not know about -- the switch
        // would read "on" forever while nothing arrives.
        await sub.unsubscribe().catch(() => {})
        state.value = 'off'
        return
      }
      state.value = 'on'
      useToast().push('اعلان‌های مرورگر روشن شد.', 'success')
    } finally {
      busy.value = false
    }
  }

  async function disable() {
    if (busy.value) return
    busy.value = true
    try {
      const sub = isPushSupported() ? await existingSubscription() : null
      if (sub) {
        await apiFetch('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint }, silent: true })
        await sub.unsubscribe().catch(() => {})
      }
      state.value = baseState() ?? 'off'
    } finally {
      busy.value = false
    }
  }

  return { state, busy, refresh, enable, disable }
}

/**
 * Logout's first step: drop this browser's push subscription while the session still exists,
 * so the next account on this device does not receive the previous salon's notifications.
 * Best-effort and silent -- a failure here must never block signing out.
 */
export async function unbindPushBeforeLogout(): Promise<void> {
  if (!isPushSupported()) return
  try {
    const sub = await existingSubscription()
    if (!sub) return
    await useApi().apiFetch('/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint }, silent: true, redirectOn401: false })
    await sub.unsubscribe()
  } catch {
    // Signing out matters more than this cleanup.
  }
}
