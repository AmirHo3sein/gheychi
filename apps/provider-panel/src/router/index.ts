import { createRouter, type RouterHistory, type Router } from 'vue-router'
import type { SessionUser } from '@/stores/session'
import { useSessionStore } from '@/stores/session'
import { useSalon } from '@/composables/useSalon'
import { useFeatureFlags } from '@/composables/useFeatureFlags'
import { useApi } from '@/composables/useApi'
import { useToast } from '@/composables/useToast'
import AppLayout from '@/components/layout/AppLayout.vue'

const routes = [
  { path: '/login', name: 'login', component: () => import('@/pages/LoginView.vue'), meta: { public: true } },
  { path: '/onboarding', name: 'onboarding', component: () => import('@/pages/OnboardingView.vue') },
  { path: '/pending-approval', name: 'pending-approval', component: () => import('@/pages/PendingApprovalView.vue') },
  {
    path: '/',
    component: AppLayout,
    children: [
      { path: '', name: 'dashboard', component: () => import('@/pages/DashboardView.vue') },
      { path: 'bookings', name: 'bookings', component: () => import('@/pages/BookingsView.vue') },
      { path: 'services', name: 'services', component: () => import('@/pages/ServicesView.vue') },
      { path: 'coupons', name: 'coupons', component: () => import('@/pages/CouponsView.vue') },
      { path: 'team', name: 'team', component: () => import('@/pages/TeamView.vue') },
      { path: 'hours', name: 'hours', component: () => import('@/pages/HoursView.vue') },
      { path: 'photos', name: 'photos', component: () => import('@/pages/PhotosView.vue') },
      { path: 'stories', name: 'stories', component: () => import('@/pages/StoriesView.vue') },
      { path: 'portfolio', name: 'portfolio', component: () => import('@/pages/PortfolioView.vue') },
      { path: 'settings', name: 'settings', component: () => import('@/pages/SalonSettingsView.vue') },
      { path: 'reviews', name: 'reviews', component: () => import('@/pages/ReviewsView.vue') },
      { path: 'earnings', name: 'earnings', component: () => import('@/pages/EarningsView.vue') },
      { path: 'plan', name: 'plan', component: () => import('@/pages/PlanView.vue') },
      // Deliberately NOT guarded on `referralsEnabled`. The flag only stops new rewards
      // being granted server-side; the page still holds the owner's referral history and
      // their wallet balance, which is real money that must stay reachable regardless.
      // The page renders its own explanatory disabled state -- see ReferralView.vue.
      { path: 'referral', name: 'referral', component: () => import('@/pages/ReferralView.vue') },
      { path: 'customers', name: 'customers', component: () => import('@/pages/CustomersView.vue') },
      { path: 'customers/:id', name: 'customer-detail', component: () => import('@/pages/CustomerDetailView.vue') },
    ],
  },
]

export function createAppRouter(history: RouterHistory): Router {
  const router = createRouter({ history, routes })

  router.beforeEach(async (to) => {
    const session = useSessionStore()
    // Every route needs these before it renders, to avoid a flash of a banner/feature
    // that's actually enabled -- ensureLoaded() is a no-op once already loaded, so this is
    // safe to await unconditionally.
    const { ensureLoaded: ensureFeatureFlagsLoaded } = useFeatureFlags()

    if (!session.checked) {
      const { apiFetch } = useApi()
      const [{ data, error }] = await Promise.all([
        apiFetch<SessionUser>('/auth/me', { silent: true, redirectOn401: false }),
        ensureFeatureFlagsLoaded(),
      ])
      // A network/5xx error isn't the same as a confirmed 401 -- don't mark session.checked
      // in that case, so the next navigation retries instead of permanently treating a
      // transient blip as "confirmed logged out" for the rest of this tab's session. Mirrors
      // the same distinction useSalon.refetch() already makes for 404 vs. other errors.
      if (!error || error.status === 401) {
        session.setUser(data)
      }
    } else {
      await ensureFeatureFlagsLoaded()
    }

    if (to.meta.public) {
      return session.isLoggedIn ? { name: 'dashboard' } : true
    }

    if (!session.isLoggedIn) {
      return { name: 'login' }
    }

    const { salon, checked, refetch } = useSalon()
    if (!checked.value) {
      const { error } = await refetch()
      // A non-404 failure (5xx, network) leaves salon null AND checked false -- that is not
      // "no salon yet", so it must not route to onboarding (where an owner with an approved
      // salon would be invited to create a second one). Cancel this navigation and say so;
      // the next navigation (or a reload) probes again since `checked` never flipped.
      if (error && !salon.value) {
        useToast().push('اطلاعات آرایشگاه بارگذاری نشد. دوباره تلاش کنید.')
        return false
      }
    }

    if (!salon.value) {
      return to.name === 'onboarding' ? true : { name: 'onboarding' }
    }

    if (salon.value.status !== 'approved') {
      // A rejected salon owner needs a real path to fix what got them rejected before
      // resubmitting -- PendingApprovalView's "ویرایش اطلاعات آرایشگاه" link goes to
      // /settings, so that route must stay reachable specifically in the rejected state.
      // pending/suspended salons have no such editable-before-resubmit path, so they still
      // get bounced straight back to pending-approval.
      const rejectedSettingsAccess = salon.value.status === 'rejected' && to.name === 'settings'
      // The onboarding wizard creates the salon *before* it saves the hours and the first
      // service, so a failure on either of those later calls leaves a pending salon that
      // can't be completed from the wizard once the page is reloaded. Let a pending salon
      // reach exactly those two screens to finish the job -- otherwise an admin can approve
      // a listing with no hours and no services, which is unbookable. Safe: nothing about a
      // non-approved salon is publicly visible or bookable.
      const pendingRepairAccess =
        salon.value.status === 'pending' && (to.name === 'hours' || to.name === 'services')
      return to.name === 'pending-approval' || rejectedSettingsAccess || pendingRepairAccess
        ? true
        : { name: 'pending-approval' }
    }

    if (to.name === 'onboarding' || to.name === 'pending-approval') {
      return { name: 'dashboard' }
    }

    return true
  })

  return router
}
