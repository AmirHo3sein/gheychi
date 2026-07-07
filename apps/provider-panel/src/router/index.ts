import { createRouter, type RouterHistory, type Router } from 'vue-router'
import type { SessionUser } from '@/stores/session'
import { useSessionStore } from '@/stores/session'
import { useSalon } from '@/composables/useSalon'
import { useApi } from '@/composables/useApi'

const routes = [
  { path: '/login', name: 'login', component: () => import('@/pages/LoginView.vue'), meta: { public: true } },
  { path: '/onboarding', name: 'onboarding', component: () => import('@/pages/OnboardingView.vue') },
  { path: '/pending-approval', name: 'pending-approval', component: () => import('@/pages/PendingApprovalView.vue') },
  { path: '/', name: 'dashboard', component: () => import('@/pages/DashboardView.vue') },
  { path: '/bookings', name: 'bookings', component: () => import('@/pages/BookingsView.vue') },
  { path: '/services', name: 'services', component: () => import('@/pages/ServicesView.vue') },
  { path: '/hours', name: 'hours', component: () => import('@/pages/HoursView.vue') },
  { path: '/photos', name: 'photos', component: () => import('@/pages/PhotosView.vue') },
  { path: '/reviews', name: 'reviews', component: () => import('@/pages/ReviewsView.vue') },
  { path: '/earnings', name: 'earnings', component: () => import('@/pages/EarningsView.vue') },
]

export function createAppRouter(history: RouterHistory): Router {
  const router = createRouter({ history, routes })

  router.beforeEach(async (to) => {
    const session = useSessionStore()

    if (!session.checked) {
      const { apiFetch } = useApi()
      const { data } = await apiFetch<SessionUser>('/auth/me', { silent: true, redirectOn401: false })
      session.setUser(data)
    }

    if (to.meta.public) {
      return session.isLoggedIn ? { name: 'dashboard' } : true
    }

    if (!session.isLoggedIn) {
      return { name: 'login' }
    }

    const { salon, checked, refetch } = useSalon()
    if (!checked.value) await refetch()

    if (!salon.value) {
      return to.name === 'onboarding' ? true : { name: 'onboarding' }
    }

    if (salon.value.status !== 'approved') {
      return to.name === 'pending-approval' ? true : { name: 'pending-approval' }
    }

    if (to.name === 'onboarding' || to.name === 'pending-approval') {
      return { name: 'dashboard' }
    }

    return true
  })

  return router
}
