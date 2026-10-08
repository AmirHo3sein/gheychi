import type { Router } from 'vue-router'
import { resetSalon } from '@/composables/useSalon'
import { setUnauthorizedHandler } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import { useSessionStore } from '@/stores/session'

export const SESSION_EXPIRED_MESSAGE = 'نشست شما منقضی شده است؛ دوباره وارد شوید.'

/**
 * Routes a 401 to the login screen through the router (no page reload, so unsaved form
 * state in memory is not torn down mid-navigation) and remembers where the owner was so the
 * login can return them there. The session and salon singletons are cleared first: the
 * router guard bounces /login straight back to the dashboard while it still believes the
 * owner is logged in.
 *
 * A dashboard fires several requests at once, so one expiry yields several 401s; only the
 * first one acts, and nothing happens if the owner is already on /login.
 */
export function installSessionExpiryHandler(router: Router): void {
  let handling = false
  setUnauthorizedHandler(() => {
    if (handling || router.currentRoute.value.path === '/login') return
    handling = true
    const from = router.currentRoute.value.fullPath
    useSessionStore().setUser(null)
    resetSalon()
    useToast().push(SESSION_EXPIRED_MESSAGE, 'error')
    void router
      .push({ path: '/login', query: from === '/' ? undefined : { redirect: from } })
      .finally(() => {
        handling = false
      })
  })
}
