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
      { path: '', name: 'dashboard', component: () => import('@/pages/DashboardView.vue'), meta: { title: 'داشبورد' } },
      { path: 'analytics', name: 'analytics', component: () => import('@/pages/AnalyticsView.vue'), meta: { title: 'آمار و تحلیل' } },
      { path: 'salons', name: 'salons', component: () => import('@/pages/SalonsView.vue'), meta: { title: 'آرایشگاه‌ها' } },
      { path: 'salons/:id', name: 'salon-detail', component: () => import('@/pages/SalonDetailView.vue'), meta: { title: 'جزئیات آرایشگاه' } },
      { path: 'featured', name: 'featured', component: () => import('@/pages/FeaturedView.vue'), meta: { title: 'سالن‌های ویژه' } },
      // Deep-link only (no SidebarNav entry): addressed by booking id, so there is nothing
      // to browse to -- an agent arrives here with an id from a support ticket.
      {
        path: 'bookings/:id',
        name: 'booking-timeline',
        component: () => import('@/pages/BookingTimelineView.vue'),
        meta: { title: 'تاریخچه رزرو' },
      },
      { path: 'reviews', name: 'reviews', component: () => import('@/pages/ReviewsView.vue'), meta: { title: 'نظرات' } },
      { path: 'worker-ratings', name: 'worker-ratings', component: () => import('@/pages/WorkerRatingsView.vue'), meta: { title: 'امتیاز کارمندان' } },
      { path: 'reports', name: 'reports', component: () => import('@/pages/ReportsView.vue'), meta: { title: 'گزارش‌ها' } },
      { path: 'categories', name: 'categories', component: () => import('@/pages/CategoriesView.vue'), meta: { title: 'دسته‌بندی‌ها' } },
      {
        path: 'category-requests',
        name: 'category-requests',
        component: () => import('@/pages/CategoryRequestsView.vue'),
        meta: { title: 'درخواست‌های دسته‌بندی' },
      },
      { path: 'coupons', name: 'coupons', component: () => import('@/pages/CouponsView.vue'), meta: { title: 'کدهای تخفیف' } },
      { path: 'plans', name: 'plans', component: () => import('@/pages/PlansView.vue'), meta: { title: 'پلن‌های اشتراک' } },
      {
        path: 'subscription-coupons',
        name: 'subscription-coupons',
        component: () => import('@/pages/SubscriptionCouponsView.vue'),
        meta: { title: 'کدهای تخفیف اشتراک' },
      },
      { path: 'wallet', name: 'wallet', component: () => import('@/pages/WalletView.vue'), meta: { title: 'کیف پول' } },
      { path: 'invoices', name: 'invoices', component: () => import('@/pages/InvoicesView.vue'), meta: { title: 'صورتحساب‌ها' } },
      { path: 'referrals', name: 'referrals', component: () => import('@/pages/ReferralsView.vue'), meta: { title: 'معرفی‌ها' } },
      {
        path: 'referrals/settings',
        name: 'referral-settings',
        component: () => import('@/pages/ReferralSettingsView.vue'),
        meta: { title: 'تنظیمات معرفی' },
      },
      { path: 'blog', name: 'blog', component: () => import('@/pages/BlogPostsView.vue'), meta: { title: 'بلاگ' } },
      { path: 'blog/new', name: 'blog-new', component: () => import('@/pages/BlogEditorView.vue'), meta: { title: 'مطلب جدید' } },
      { path: 'blog/:id', name: 'blog-editor', component: () => import('@/pages/BlogEditorView.vue'), meta: { title: 'ویرایش مطلب' } },
      { path: 'users', name: 'users', component: () => import('@/pages/UsersView.vue'), meta: { title: 'کاربران' } },
      { path: 'audit-log', name: 'audit-log', component: () => import('@/pages/AuditLogView.vue'), meta: { title: 'تاریخچه اقدامات' } },
      { path: 'config', name: 'config', component: () => import('@/pages/ConfigView.vue'), meta: { title: 'تنظیمات پلتفرم' } },
      {
        path: 'feature-flags',
        name: 'feature-flags',
        component: () => import('@/pages/FeatureFlagsView.vue'),
        meta: { title: 'ویژگی‌های پلتفرم' },
      },
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
