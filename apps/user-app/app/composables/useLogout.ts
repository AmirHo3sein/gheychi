// Unbinding this browser's push subscription must happen BEFORE the session cookie is
// cleared -- DELETE /push/subscribe is scoped to { endpoint, userId }, so afterwards the
// row would be stranded owned by the user who just left and the next person to log in on
// this device would keep receiving their appointment notifications. It is also time-boxed
// rather than merely try/caught: `navigator.serviceWorker.ready` never rejects, it simply
// never resolves when there's no active registration, and a user must always be able to
// log out regardless of what the service worker is doing.
const PUSH_UNBIND_TIMEOUT_MS = 2000

// The push-unbind-then-logout sequence behind profile.vue's logout button (the only logout
// control since the header icon moved there), kept as a composable so any future entry point
// reuses the exact sequence instead of a copy that could drift.
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
