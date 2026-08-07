// Unbinding this browser's push subscription must happen BEFORE the session cookie is
// cleared -- DELETE /push/subscribe is scoped to { endpoint, userId }, so afterwards the
// row would be stranded owned by the user who just left and the next person to log in on
// this device would keep receiving their appointment notifications. It is also time-boxed
// rather than merely try/caught: `navigator.serviceWorker.ready` never rejects, it simply
// never resolves when there's no active registration, and a user must always be able to
// log out regardless of what the service worker is doing.
const PUSH_UNBIND_TIMEOUT_MS = 2000

// Shared by AppHeader.vue's header icon and profile.vue's own logout button -- both need
// the exact same push-unbind-then-logout sequence, not two copies that could drift.
export function useLogout() {
  const session = useSessionStore()
  const { apiFetch } = useApi()
  const { unsubscribe } = usePushSubscription()

  async function logout() {
    await Promise.race([
      unsubscribe().catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, PUSH_UNBIND_TIMEOUT_MS)),
    ])
    await apiFetch('/auth/logout', { method: 'POST' })
    session.setUser(null)
    await navigateTo('/login')
  }

  return { logout }
}
