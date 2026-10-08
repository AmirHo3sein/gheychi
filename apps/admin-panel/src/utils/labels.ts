// apps/admin-panel/src/utils/labels.ts
// Central Farsi label maps for every enum the API returns raw. Every getter falls
// back to the raw value instead of throwing/blanking, so a new backend enum member
// or a new platform_config key shows up (in its raw form) rather than breaking.

import type { IconName } from '@/components/ui/AppIcon.vue'
import { toPersianDigits } from './digits'

export type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

export interface LabelEntry {
  label: string
  tone: Tone
}

const SALON_STATUS: Record<string, LabelEntry> = {
  pending: { label: 'در انتظار بررسی', tone: 'warning' },
  approved: { label: 'تایید شده', tone: 'success' },
  rejected: { label: 'رد شده', tone: 'danger' },
  suspended: { label: 'معلق', tone: 'neutral' },
}

const REVIEW_STATUS: Record<string, LabelEntry> = {
  published: { label: 'منتشر شده', tone: 'success' },
  rejected: { label: 'رد شده', tone: 'danger' },
  // Customer self-deleted (DELETE /api/reviews/:id) -- distinct from an admin 'rejected'
  // call, and distinct enough visually that it doesn't read as just another
  // moderation-queue state. worker_ratings.status never carries this value itself (see
  // worker-rating.entity.ts) -- a rating whose parent review was withdrawn borrows this
  // entry via workerRatingStatusLabel() below.
  withdrawn: { label: 'حذف شده توسط کاربر', tone: 'neutral' },
}

const USER_STATUS: Record<string, LabelEntry> = {
  active: { label: 'فعال', tone: 'success' },
  suspended: { label: 'معلق', tone: 'danger' },
}

const USER_ROLE: Record<string, string> = {
  customer: 'مشتری',
  provider: 'سالن‌دار',
  admin: 'مدیر',
}

const GENDER_TARGET: Record<string, string> = {
  women: 'بانوان',
  men: 'آقایان',
}

export function salonStatusLabel(status: string): LabelEntry {
  return SALON_STATUS[status] ?? { label: status, tone: 'neutral' }
}

export function reviewStatusLabel(status: string): LabelEntry {
  return REVIEW_STATUS[status] ?? { label: status, tone: 'neutral' }
}

/**
 * A worker rating's own status is only published/rejected (worker-rating.entity.ts), but
 * ReviewsService.remove() cascades a customer's own review deletion onto it as
 * 'rejected' -- so the rating row alone cannot be told apart from an admin rejection.
 * The parent review's status is what disambiguates, and it wins here: a withdrawn parent
 * is a customer deletion, not a moderation decision an admin can reverse.
 */
export function workerRatingStatusLabel(status: string, reviewStatus: string): LabelEntry {
  return reviewStatusLabel(reviewStatus === 'withdrawn' ? 'withdrawn' : status)
}

// Shared by salon stories and portfolio items (both carry the same two-state enum).
const SHOWCASE_STATUS: Record<string, LabelEntry> = {
  published: { label: 'منتشر شده', tone: 'success' },
  removed: { label: 'حذف شده', tone: 'danger' },
}

export function showcaseStatusLabel(status: string): LabelEntry {
  return SHOWCASE_STATUS[status] ?? { label: status, tone: 'neutral' }
}

export function userStatusLabel(status: string): LabelEntry {
  return USER_STATUS[status] ?? { label: status, tone: 'neutral' }
}

export function userRoleLabel(role: string): string {
  return USER_ROLE[role] ?? role
}

export function genderTargetLabel(gender: string): string {
  return GENDER_TARGET[gender] ?? gender
}

const WALLET_TRANSACTION_TYPE: Record<string, LabelEntry> = {
  admin_adjustment: { label: 'تعدیل دستی', tone: 'info' },
  referral_reward: { label: 'پاداش معرفی', tone: 'success' },
  referral_reversal: { label: 'برگشت پاداش معرفی', tone: 'danger' },
  booking_spend: { label: 'استفاده در نوبت', tone: 'info' },
  booking_spend_reversal: { label: 'برگشت وجه نوبت', tone: 'success' },
}

export function walletTransactionTypeLabel(type: string): LabelEntry {
  return WALLET_TRANSACTION_TYPE[type] ?? { label: type, tone: 'neutral' }
}

const WALLET_CURRENCY: Record<string, string> = {
  toman: 'تومان',
  points: 'امتیاز',
}

export function currencyLabel(currency: string): string {
  return WALLET_CURRENCY[currency] ?? currency
}

const REFERRAL_STATUS: Record<string, LabelEntry> = {
  awaiting_qualifying_event: { label: 'در انتظار رویداد', tone: 'warning' },
  // Slice 4: reachable now that tryGrantReward grants wallet-kind rewards but skips
  // discount-kind ones (percent_discount/fixed_discount, not supported until slice 5) --
  // one beneficiary side has a granted referral_rewards row, the other is still pending
  // on a future slice. Not a placeholder -- see referral.entity.ts's ReferralStatus note.
  partially_granted: { label: 'اعطای جزئی پاداش', tone: 'info' },
  reward_granted: { label: 'پاداش اعطا شد', tone: 'success' },
  expired: { label: 'منقضی شده', tone: 'neutral' },
  cancelled: { label: 'لغو شده', tone: 'danger' },
}

export function referralStatusLabel(status: string): LabelEntry {
  return REFERRAL_STATUS[status] ?? { label: status, tone: 'neutral' }
}

const REFERRAL_TYPE: Record<string, string> = {
  user: 'کاربر عادی',
  salon_owner: 'صاحب سالن',
  worker: 'کارمند',
}

export function referralTypeLabel(type: string): string {
  return REFERRAL_TYPE[type] ?? type
}

const REWARD_KIND: Record<string, string> = {
  wallet_credit: 'اعتبار کیف پول',
  percent_discount: 'تخفیف درصدی',
  fixed_discount: 'تخفیف مبلغ ثابت',
  cashback: 'بازگشت وجه',
  loyalty_points: 'امتیاز وفاداری',
}

export function rewardKindLabel(kind: string): string {
  return REWARD_KIND[kind] ?? kind
}

/** Unit suffix for a reward's numeric value/max fields, driven by its kind. */
export function rewardKindUnit(kind: string): string {
  if (kind === 'percent_discount') return '٪'
  if (kind === 'loyalty_points') return 'امتیاز'
  return 'تومان'
}

const QUALIFYING_EVENT: Record<string, string> = {
  first_completed_booking: 'اولین نوبت تکمیل‌شده',
  first_paid_booking: 'اولین نوبت پرداخت‌شده',
}

export function qualifyingEventLabel(event: string): string {
  return QUALIFYING_EVENT[event] ?? event
}

const BLOG_POST_STATUS: Record<string, LabelEntry> = {
  draft: { label: 'پیش‌نویس', tone: 'neutral' },
  published: { label: 'منتشرشده', tone: 'success' },
}

export function blogPostStatusLabel(status: string): LabelEntry {
  return BLOG_POST_STATUS[status] ?? { label: status, tone: 'neutral' }
}

// Every member of the backend's BookingStatus union. 'pending_approval' and
// 'rejected_by_salon' only ever occur for a salon running the manual-approval workflow;
// the other seven occur in both modes. A 'pending_approval' booking has NO payment behind
// it yet -- the wording must never imply money has moved.
const BOOKING_STATUS: Record<string, LabelEntry> = {
  pending_approval: { label: 'در انتظار تایید سالن', tone: 'warning' },
  pending_payment: { label: 'در انتظار پرداخت', tone: 'warning' },
  confirmed: { label: 'تایید شده', tone: 'success' },
  completed: { label: 'انجام شده', tone: 'success' },
  cancelled_by_user: { label: 'لغو شده توسط مشتری', tone: 'neutral' },
  cancelled_by_salon: { label: 'لغو شده توسط سالن', tone: 'danger' },
  cancelled_by_admin: { label: 'لغو توسط پشتیبانی', tone: 'danger' },
  rejected_by_salon: { label: 'رد شده توسط سالن', tone: 'danger' },
  expired: { label: 'منقضی شده', tone: 'neutral' },
  no_show: { label: 'عدم حضور', tone: 'danger' },
}

export function bookingStatusLabel(status: string): LabelEntry {
  return BOOKING_STATUS[status] ?? { label: status, tone: 'neutral' }
}

// Salon.bookingConfirmationMode. Owner-controlled -- this app only ever displays it.
const BOOKING_CONFIRMATION_MODE: Record<string, LabelEntry> = {
  automatic: { label: 'تایید خودکار', tone: 'success' },
  manual_approval: { label: 'تایید دستی سالن', tone: 'info' },
}

export function bookingConfirmationModeLabel(mode: string): LabelEntry {
  return BOOKING_CONFIRMATION_MODE[mode] ?? { label: mode, tone: 'neutral' }
}

// payments.status. 'refund_pending' is the one an operator is actually hunting for -- money
// is owed back and has not been returned yet -- so it carries the danger tone rather than a
// softer "in progress" one; 'refunded' is a settled, successful outcome.
const PAYMENT_STATUS: Record<string, LabelEntry> = {
  initiated: { label: 'در انتظار پرداخت', tone: 'warning' },
  paid: { label: 'پرداخت‌شده', tone: 'success' },
  refund_pending: { label: 'در انتظار استرداد', tone: 'danger' },
  refunded: { label: 'مسترد شده', tone: 'neutral' },
  failed: { label: 'ناموفق', tone: 'danger' },
}

export function paymentStatusLabel(status: string): LabelEntry {
  return PAYMENT_STATUS[status] ?? { label: status, tone: 'neutral' }
}

// bookings.source -- how the row was CREATED, not the marketing channel (that's
// attributionSource below). 'manual' is the owner recording a walk-in or phone customer.
const BOOKING_SOURCE: Record<string, string> = {
  online: 'رزرو آنلاین',
  manual: 'ثبت توسط سالن',
}

export function bookingSourceLabel(source: string): string {
  return BOOKING_SOURCE[source] ?? source
}

// bookings.attribution_source -- the marketing channel a booking is attributed to. NULL
// (organic in-app navigation, or any manual booking) has no entry here on purpose; a caller
// renders that as "—" rather than inventing an "organic" label the backend never writes.
const BOOKING_ATTRIBUTION_SOURCE: Record<string, string> = {
  qr: 'کد QR',
  direct: 'لینک مستقیم',
  search: 'موتور جست‌وجو',
}

export function bookingAttributionSourceLabel(source: string): string {
  return BOOKING_ATTRIBUTION_SOURCE[source] ?? source
}

// booking_events.event_type -- a deliberate superset of the status transitions (see
// booking-event.entity.ts), so several of these describe things happening *around* a
// status change and have no BOOKING_STATUS counterpart.
const BOOKING_EVENT_TYPE: Record<string, LabelEntry> = {
  BOOKING_CREATED: { label: 'ایجاد نوبت', tone: 'info' },
  APPROVAL_REQUESTED: { label: 'ارسال درخواست تایید', tone: 'warning' },
  SALON_APPROVED: { label: 'تایید توسط سالن', tone: 'success' },
  SALON_REJECTED: { label: 'رد توسط سالن', tone: 'danger' },
  APPROVAL_EXPIRED: { label: 'اتمام مهلت تایید', tone: 'neutral' },
  PAYMENT_WINDOW_STARTED: { label: 'شروع مهلت پرداخت', tone: 'info' },
  PAYMENT_INITIATED: { label: 'آغاز پرداخت', tone: 'info' },
  PAYMENT_SUCCEEDED: { label: 'پرداخت موفق', tone: 'success' },
  PAYMENT_FAILED: { label: 'پرداخت ناموفق', tone: 'danger' },
  PAYMENT_EXPIRED: { label: 'اتمام مهلت پرداخت', tone: 'neutral' },
  BOOKING_CONFIRMED: { label: 'قطعی شدن نوبت', tone: 'success' },
  SLOT_RELEASED: { label: 'آزادسازی نوبت', tone: 'neutral' },
  BOOKING_CANCELLED: { label: 'لغو نوبت', tone: 'danger' },
  BOOKING_COMPLETED: { label: 'تکمیل نوبت', tone: 'success' },
  BOOKING_NO_SHOW: { label: 'عدم حضور مشتری', tone: 'danger' },
}

export function bookingEventTypeLabel(eventType: string): LabelEntry {
  return BOOKING_EVENT_TYPE[eventType] ?? { label: eventType, tone: 'neutral' }
}

// booking_events.actor_type. 'system' is every cron-driven transition (approval/payment
// expiry) -- genuinely no human actor, and it must not read as one.
const BOOKING_EVENT_ACTOR_TYPE: Record<string, string> = {
  customer: 'مشتری',
  salon_owner: 'سالن‌دار',
  admin: 'مدیر',
  system: 'سامانه',
}

export function bookingEventActorTypeLabel(actorType: string): string {
  return BOOKING_EVENT_ACTOR_TYPE[actorType] ?? actorType
}

// Keys the backend currently writes into booking_events.metadata (free-form jsonb, so
// this is a best-effort prettifier -- an unmapped key falls back to its raw name rather
// than being hidden, since a support timeline must never silently drop context).
const BOOKING_EVENT_METADATA_KEY: Record<string, string> = {
  confirmationMode: 'حالت تایید',
  depositAmount: 'مبلغ بیعانه',
  approvalTimeoutMinutes: 'مهلت تایید',
  approvalExpiresAt: 'پایان مهلت تایید',
  paymentTimeoutMinutes: 'مهلت پرداخت',
  paymentExpiresAt: 'پایان مهلت پرداخت',
  reason: 'دلیل',
  cause: 'علت',
  fromStatus: 'وضعیت پیشین',
  refundOwed: 'مبلغ قابل استرداد',
  cancelledBy: 'لغو توسط',
}

export function bookingEventMetadataKeyLabel(key: string): string {
  return BOOKING_EVENT_METADATA_KEY[key] ?? key
}

// Values of the `cause` metadata key on SLOT_RELEASED events.
const BOOKING_EVENT_CAUSE: Record<string, string> = {
  approval_expired: 'اتمام مهلت تایید',
  payment_expired: 'اتمام مهلت پرداخت',
  salon_rejected: 'رد توسط سالن',
  cancelled: 'لغو نوبت',
  cancelled_by_admin: 'لغو توسط پشتیبانی',
  zero_deposit: 'بدون نیاز به بیعانه',
}

export function bookingEventCauseLabel(cause: string): string {
  return BOOKING_EVENT_CAUSE[cause] ?? cause
}

// Keys must stay in sync with the backend's @AuditAction() names (audit.decorator.ts).
const AUDIT_ACTION: Record<string, LabelEntry> = {
  'salon.status.set': { label: 'تغییر وضعیت سالن', tone: 'warning' },
  'salon.featured.set': { label: 'تغییر نشان ویژه', tone: 'info' },
  'salon.story.status.set': { label: 'تعدیل استوری', tone: 'warning' },
  'salon.portfolio.status.set': { label: 'تعدیل نمونه کار', tone: 'warning' },
  'user.status.set': { label: 'تغییر وضعیت کاربر', tone: 'danger' },
  'review.moderate': { label: 'تعدیل نظر', tone: 'warning' },
  'category.create': { label: 'ایجاد دسته‌بندی', tone: 'success' },
  'category.update': { label: 'ویرایش دسته‌بندی', tone: 'info' },
  'category.delete': { label: 'حذف دسته‌بندی', tone: 'danger' },
  'category-request.approve': { label: 'تایید درخواست دسته‌بندی', tone: 'success' },
  'category-request.reject': { label: 'رد درخواست دسته‌بندی', tone: 'danger' },
  'beauty_concept.create': { label: 'ایجاد مفهوم راهنمای زیبایی', tone: 'success' },
  'beauty_concept.update': { label: 'ویرایش مفهوم راهنمای زیبایی', tone: 'info' },
  'config.update': { label: 'به‌روزرسانی تنظیمات', tone: 'info' },
  'report.resolve': { label: 'رسیدگی به گزارش', tone: 'success' },
  'post.create': { label: 'ایجاد مطلب بلاگ', tone: 'success' },
  'post.update': { label: 'ویرایش مطلب بلاگ', tone: 'info' },
  'post.publish': { label: 'انتشار مطلب بلاگ', tone: 'success' },
  'post.unpublish': { label: 'لغو انتشار مطلب بلاگ', tone: 'warning' },
  'post.delete': { label: 'حذف مطلب بلاگ', tone: 'danger' },
  'post.cover.upload': { label: 'آپلود تصویر شاخص مطلب', tone: 'info' },
  'post.cover.remove': { label: 'حذف تصویر شاخص مطلب', tone: 'warning' },
  'blogcategory.create': { label: 'ایجاد دسته‌بندی بلاگ', tone: 'success' },
  'blogcategory.update': { label: 'ویرایش دسته‌بندی بلاگ', tone: 'info' },
  'blogcategory.delete': { label: 'حذف دسته‌بندی بلاگ', tone: 'danger' },
  'wallet.adjust': { label: 'تعدیل موجودی کیف پول', tone: 'warning' },
  'referral-reward-type.update': { label: 'ویرایش نوع پاداش معرفی', tone: 'info' },
  'referral.cancel': { label: 'لغو معرفی', tone: 'danger' },
  'coupon.create': { label: 'ایجاد کد تخفیف', tone: 'success' },
  'coupon.update': { label: 'ویرایش کد تخفیف', tone: 'info' },
  'coupon.delete': { label: 'حذف کد تخفیف', tone: 'danger' },
  'worker-rating.moderate': { label: 'تعدیل ارزیابی کارمند', tone: 'warning' },
  'booking.approval.approved': { label: 'تایید درخواست رزرو', tone: 'success' },
  'booking.approval.rejected': { label: 'رد درخواست رزرو', tone: 'danger' },
  'booking.cancelled_by_admin': { label: 'لغو نوبت توسط پشتیبانی', tone: 'danger' },
  'booking.rescheduled': { label: 'جابه‌جایی زمان نوبت', tone: 'info' },
  'booking-settings.update': { label: 'ویرایش تنظیمات رزرو سالن', tone: 'info' },
  'feature-flags.update': { label: 'تغییر قابلیت‌های پلتفرم', tone: 'warning' },
  'invoice.payment.record': { label: 'ثبت پرداخت صورتحساب', tone: 'success' },
  'salon.handle.set': { label: 'تغییر شناسه عمومی سالن', tone: 'info' },
  // Monetization initiative (plans, subscriptions, subscription coupons, billing periods).
  'plan.create': { label: 'ایجاد پلن اشتراک', tone: 'success' },
  'plan.update': { label: 'ویرایش پلن اشتراک', tone: 'info' },
  'plan.delete': { label: 'حذف پلن اشتراک', tone: 'danger' },
  'subscription.plan.set': { label: 'تغییر پلن اشتراک سالن', tone: 'info' },
  'subscription.cancel': { label: 'لغو اشتراک سالن', tone: 'danger' },
  'subscription.overrides.set': { label: 'تغییر استثنای امکانات سالن', tone: 'warning' },
  'subscription.billing-period.create': { label: 'ایجاد دوره صورتحساب اشتراک', tone: 'success' },
  'subscription.billing-period.status.set': { label: 'تسویه دوره صورتحساب اشتراک', tone: 'warning' },
  'subscription-coupon.create': { label: 'ایجاد کد تخفیف اشتراک', tone: 'success' },
  'subscription-coupon.update': { label: 'ویرایش کد تخفیف اشتراک', tone: 'info' },
  'subscription-coupon.delete': { label: 'غیرفعال‌سازی کد تخفیف اشتراک', tone: 'danger' },
}

// Canonical list of the audited action names -- filter dropdowns and tests derive from
// this export instead of re-declaring the action strings at every call site.
export const AUDIT_ACTION_KEYS = Object.keys(AUDIT_ACTION)

const AUDIT_TARGET_TYPE: Record<string, string> = {
  salon: 'سالن',
  user: 'کاربر',
  review: 'نظر',
  story: 'استوری',
  portfolioitem: 'نمونه کار',
  category: 'دسته‌بندی',
  beauty_concept: 'مفهوم راهنمای زیبایی',
  booking: 'نوبت',
  'category-request': 'درخواست دسته‌بندی',
  config: 'تنظیمات',
  report: 'گزارش',
  post: 'مطلب بلاگ',
  blogcategory: 'دسته‌بندی بلاگ',
  wallet: 'کیف پول',
  'referral-reward-type': 'نوع پاداش معرفی',
  referral: 'معرفی',
  coupon: 'کد تخفیف',
  'worker-rating': 'ارزیابی کارمند',
  'feature-flags': 'قابلیت‌های پلتفرم',
  invoice: 'صورتحساب',
  plan: 'پلن اشتراک',
  'salon-subscription': 'اشتراک سالن',
  'subscription-billing-period': 'دوره صورتحساب اشتراک',
  'subscription-coupon': 'کد تخفیف اشتراک',
}

// Canonical list of the audited target types -- see AUDIT_ACTION_KEYS above.
export const AUDIT_TARGET_TYPE_KEYS = Object.keys(AUDIT_TARGET_TYPE)

const REPORT_STATUS: Record<string, LabelEntry> = {
  open: { label: 'باز', tone: 'warning' },
  resolved: { label: 'رسیدگی شده', tone: 'success' },
  dismissed: { label: 'رد شده', tone: 'neutral' },
}

const CATEGORY_REQUEST_STATUS: Record<string, LabelEntry> = {
  pending: { label: 'در انتظار بررسی', tone: 'warning' },
  approved: { label: 'تایید شده', tone: 'success' },
  rejected: { label: 'رد شده', tone: 'danger' },
}

export function auditActionLabel(action: string): LabelEntry {
  return AUDIT_ACTION[action] ?? { label: action, tone: 'neutral' }
}

export function targetTypeLabel(targetType: string): string {
  return AUDIT_TARGET_TYPE[targetType] ?? targetType
}

export function reportStatusLabel(status: string): LabelEntry {
  return REPORT_STATUS[status] ?? { label: status, tone: 'neutral' }
}

export function categoryRequestStatusLabel(status: string): LabelEntry {
  return CATEGORY_REQUEST_STATUS[status] ?? { label: status, tone: 'neutral' }
}

interface ConfigMeta {
  label: string
  hint: string
  unit: string
  icon: IconName
}

const CONFIG_META: Record<string, ConfigMeta> = {
  deposit_percent: { label: 'درصد بیعانه', hint: 'سهم بیعانه از قیمت نهایی خدمت', unit: '%', icon: 'invoice' },
  deposit_min_toman: { label: 'حداقل بیعانه', hint: 'کف مبلغ بیعانه، صرف‌نظر از درصد', unit: 'تومان', icon: 'wallet' },
  cancellation_window_hours: { label: 'مهلت لغو نوبت', hint: 'حداقل فاصله زمانی مجاز برای لغو رایگان', unit: 'ساعت', icon: 'history' },
  commission_percent: { label: 'درصد کمیسیون پلتفرم', hint: 'درصدی از بیعانه‌ای که واقعاً دریافت شده؛ نوبت بدون پرداخت آنلاین کمیسیونی ندارد', unit: '%', icon: 'invoice' },
  booking_hold_ttl_minutes: { label: 'مهلت نگه‌داری نوبت', hint: 'زمان قفل‌شدن نوبت تا پرداخت', unit: 'دقیقه', icon: 'calendar' },
  reminder_lead_hours: { label: 'یادآوری قبل از نوبت', hint: 'چند ساعت قبل، پیامک یادآوری ارسال شود', unit: 'ساعت', icon: 'bell' },
  review_edit_window_hours: { label: 'مهلت ویرایش نظر', hint: 'مدت زمانی که کاربر می‌تواند نظر ثبت‌شده را ویرایش یا حذف کند', unit: 'ساعت', icon: 'history' },
  // The GLOBAL default for the manual-approval workflow; a single salon can be given its
  // own override from its detail page. Note there is deliberately no matching
  // booking_payment_timeout_minutes key -- the payment window's global default is
  // booking_hold_ttl_minutes above (platform-config.service.ts).
  booking_approval_timeout_minutes: { label: 'مهلت تایید درخواست رزرو', hint: 'فرصت سالن برای تایید یا رد درخواست رزرو', unit: 'دقیقه', icon: 'history' },
  // Beauty guide: each analysis is a paid external AI call, so the two daily caps are the
  // cost breaker. 0 blocks new analyses entirely (per user / platform-wide).
  // Abuse limits on online booking creation (admin-config.dto.ts bounds: 1-50 / 1-20).
  booking_max_active_per_user: { label: 'سقف نوبت‌های فعال هر مشتری', hint: 'حداکثر نوبت آینده (در انتظار تایید، پرداخت یا تاییدشده) که یک مشتری هم‌زمان می‌تواند داشته باشد', unit: 'نوبت', icon: 'calendar' },
  booking_max_active_per_salon_per_user: { label: 'سقف نوبت‌های فعال هر مشتری در یک سالن', hint: 'حداکثر نوبت آینده یک مشتری نزد یک سالن', unit: 'نوبت', icon: 'calendar' },
  no_show_grace_minutes: { label: 'مهلت ثبت عدم حضور', hint: 'چند دقیقه پس از شروع نوبت، ثبت «عدم حضور» ممکن می‌شود (۰ تا ۱۴۴۰)', unit: 'دقیقه', icon: 'history' },
  beauty_guide_daily_limit_per_user: { label: 'سقف روزانه راهنمای زیبایی برای هر کاربر', hint: 'حداکثر تعداد تحلیل تصویر هر کاربر در یک روز (۰ = مسدود)', unit: 'تحلیل', icon: 'sparkles' },
  beauty_guide_daily_limit_global: { label: 'سقف روزانه کل راهنماهای زیبایی (کنترل هزینه)', hint: 'حداکثر تعداد کل تحلیل‌های پلتفرم در یک روز؛ هر تحلیل یک فراخوانی پولی سرویس هوش مصنوعی است', unit: 'تحلیل', icon: 'sparkles' },
  beauty_guide_retention_days: { label: 'مدت نگهداری تصاویر راهنمای زیبایی (روز)', hint: 'پس از این مدت، راهنما و تصویر مشتری حذف می‌شود (مگر به نوبت آینده‌ای متصل باشد)', unit: 'روز', icon: 'history' },
}

/**
 * Pricing shapes of a salon service (salon_services.pricing_type). Only 'fixed' is
 * bookable online; the others are catalog-display prices the salon quotes itself.
 */
const PRICING_TYPE: Record<string, string> = {
  fixed: 'ثابت',
  from: 'از',
  range: 'بازه‌ای',
  quote: 'پس از استعلام',
}

export function pricingTypeLabel(type: string): string {
  return PRICING_TYPE[type] ?? type
}

/** 0 = Sunday .. 6 = Saturday -- JS Date.getDay(), the numbering working_hours.weekday uses. */
const WEEKDAY = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه']

export function weekdayLabel(day: number): string {
  return WEEKDAY[day] ?? String(day)
}

interface NotificationTypeMeta {
  label: string
  icon: IconName
}

/**
 * admin_notifications.type. Title/body/link are server-composed, so this only adds the
 * glyph and a fallback title; an unmapped type still renders with the generic bell.
 */
const NOTIFICATION_TYPE: Record<string, NotificationTypeMeta> = {
  salon_resubmitted: { label: 'ارسال مجدد سالن', icon: 'salons' },
  report_created: { label: 'گزارش جدید', icon: 'flag' },
  salon_material_edit: { label: 'تغییر مهم در اطلاعات سالن', icon: 'pencil' },
}

export function notificationTypeMeta(type: string): NotificationTypeMeta {
  return NOTIFICATION_TYPE[type] ?? { label: 'اعلان', icon: 'bell' }
}

/** Falls back to the raw key as its own label -- new config keys stay editable, just less pretty. */
export function configKeyMeta(key: string): ConfigMeta {
  return CONFIG_META[key] ?? { label: key, hint: '', unit: '', icon: 'config' }
}

const INVOICE_STATUS: Record<string, LabelEntry> = {
  issued: { label: 'صادرشده', tone: 'info' },
  partially_paid: { label: 'پرداخت جزئی', tone: 'warning' },
  paid: { label: 'پرداخت‌شده', tone: 'success' },
  void: { label: 'باطل‌شده', tone: 'neutral' },
}

export function invoiceStatusLabel(status: string): LabelEntry {
  return INVOICE_STATUS[status] ?? { label: status, tone: 'neutral' }
}

const INVOICE_PAYMENT_METHOD: Record<string, string> = {
  bank_transfer: 'حواله بانکی',
  cash: 'نقدی',
  other: 'سایر',
  automatic_payout: 'واریز خودکار',
  wallet_credit: 'کیف پول',
}

export function invoicePaymentMethodLabel(method: string): string {
  return INVOICE_PAYMENT_METHOD[method] ?? method
}

/** Persian month names for jalaliMonth (1-12), matching JalaliDatePicker.vue's own list. */
const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
]

// Plain digit substitution, not toLocaleString('fa-IR') -- a 4-digit year would
// otherwise pick up a "٬" thousands separator.
export function jalaliMonthLabel(year: number, month: number): string {
  const name = JALALI_MONTHS[month - 1] ?? String(month)
  return `${name} ${toPersianDigits(year)}`
}

// Every raw event_name AnalyticsEventRecord currently writes (see
// analytics-aggregation.service.ts's FUNNEL_EVENTS plus the non-funnel events other
// services fire) -- kept in one place so AnalyticsView's totals table never has to show a
// raw snake_case string for a known event.
const ANALYTICS_EVENT: Record<string, string> = {
  booking_started: 'شروع رزرو',
  booking_confirmed: 'تایید نوبت',
  booking_cancelled: 'لغو نوبت',
  payment_succeeded: 'پرداخت موفق',
  user_registered: 'ثبت‌نام کاربر',
  salon_submitted: 'ثبت سالن',
  search_performed: 'جستجو',
  salon_profile_viewed: 'مشاهده صفحه سالن',
  beauty_guide_created: 'ساخت راهنمای زیبایی',
  beauty_guide_reused: 'استفاده مجدد از راهنمای زیبایی',
  beauty_guide_updated: 'به‌روزرسانی راهنمای زیبایی',
  beauty_guide_deleted: 'حذف راهنمای زیبایی',
  beauty_guide_analysis_started: 'شروع تحلیل تصویر',
  beauty_guide_analysis_completed: 'تحلیل تصویر موفق',
  beauty_guide_analysis_failed: 'تحلیل تصویر ناموفق',
  beauty_guide_matches_viewed: 'مشاهده سالن‌های پیشنهادی',
  beauty_guide_booking_started: 'شروع رزرو از راهنمای زیبایی',
  beauty_guide_booking_confirmed: 'تایید نوبت از راهنمای زیبایی',
}

export function analyticsEventLabel(eventName: string): string {
  return ANALYTICS_EVENT[eventName] ?? eventName
}
