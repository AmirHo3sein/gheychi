import { createRouter, type RouterHistory, type Router } from 'vue-router'
import type { SessionUser } from '@/stores/session'
import { useSessionStore } from '@/stores/session'
import { useApi } from '@/composables/useApi'
import AppLayout from '@/components/layout/AppLayout.vue'

const routes = [
  { path: '/login', name: 'login', component: () => import('@/pages/LoginView.vue'), meta: { public: true } },
  { path: '/forbidden', name: 'forbidden', component: () => import('@/pages/ForbiddenView.vue') },
  {
    path: '/',
    component: AppLayout,
    children: [
      { path: '', name: 'dashboard', component: () => import('@/pages/DashboardView.vue') },
      { path: 'salons', name: 'salons', component: () => import('@/pages/SalonsView.vue') },
      { path: 'salons/:id', name: 'salon-detail', component: () => import('@/pages/SalonDetailView.vue') },
      { path: 'reviews', name: 'reviews', component: () => import('@/pages/ReviewsView.vue') },
      { path: 'categories', name: 'categories', component: () => import('@/pages/CategoriesView.vue') },
    ],
  },
]

export function createAppRouter(history: RouterHistory): Router {
  const router = createRouter({ history, routes })

  router.beforeEach(async (to) => {
    const session = useSessionStore()

    if (!session.checked) {
      const { apiFetch } = useApi()
      const { data, error } = await apiFetch<SessionUser>('/auth/me', { silent: true, redirectOn401: false })
      // A network/5xx error isn't the same as a confirmed 401 -- don't mark session.checked
      // in that case, so the next navigation retries instead of permanently treating a
      // transient blip as "confirmed logged out." Mirrors provider-panel's router guard.
      if (!error || error.status === 401) {
        session.setUser(data)
      }
    }

    if (to.meta.public) {
      return session.isLoggedIn ? { name: 'dashboard' } : true
    }

    if (!session.isLoggedIn) {
      return { name: 'login' }
    }

    if (!session.isAdmin) {
      return to.name === 'forbidden' ? true : { name: 'forbidden' }
    }

    if (to.name === 'forbidden') {
      return { name: 'dashboard' }
    }

    return true
  })

  return router
}
