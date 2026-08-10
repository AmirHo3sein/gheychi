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
  provider: 'آرایشگاه‌دار',
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
  booking_spend: { label: 'استفاده در رزرو', tone: 'info' },
  booking_spend_reversal: { label: 'برگشت وجه رزرو', tone: 'success' },
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

// Keys must stay in sync with the backend's @AuditAction() names (audit.decorator.ts).
const AUDIT_ACTION: Record<string, LabelEntry> = {
  'salon.status.set': { label: 'تغییر وضعیت آرایشگاه', tone: 'warning' },
  'salon.featured.set': { label: 'تغییر نشان ویژه', tone: 'info' },
  'salon.story.status.set': { label: 'تعدیل استوری', tone: 'warning' },
  'salon.portfolio.status.set': { label: 'تعدیل نمونه کار', tone: 'warning' },
  'user.status.set': { label: 'تغییر وضعیت کاربر', tone: 'danger' },
  'review.moderate': { label: 'تعدیل نظر', tone: 'warning' },
  'category.create': { label: 'ایجاد دسته‌بندی', tone: 'success' },
  'category.update': { label: 'ویرایش دسته‌بندی', tone: 'info' },
  'category.delete': { label: 'حذف دسته‌بندی', tone: 'danger' },
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
}

// Canonical list of the audited action names -- filter dropdowns and tests derive from
// this export instead of re-declaring the action strings at every call site.
export const AUDIT_ACTION_KEYS = Object.keys(AUDIT_ACTION)

const AUDIT_TARGET_TYPE: Record<string, string> = {
  salon: 'آرایشگاه',
  user: 'کاربر',
  review: 'نظر',
  story: 'استوری',
  portfolioitem: 'نمونه کار',
  category: 'دسته‌بندی',
  config: 'تنظیمات',
  report: 'گزارش',
  post: 'مطلب بلاگ',
  blogcategory: 'دسته‌بندی بلاگ',
  wallet: 'کیف پول',
  'referral-reward-type': 'نوع پاداش معرفی',
  referral: 'معرفی',
  coupon: 'کد تخفیف',
  'worker-rating': 'ارزیابی کارمند',
}

const REPORT_STATUS: Record<string, LabelEntry> = {
  open: { label: 'باز', tone: 'warning' },
  resolved: { label: 'رسیدگی شده', tone: 'success' },
  dismissed: { label: 'رد شده', tone: 'neutral' },
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

interface ConfigMeta {
  label: string
  hint: string
  unit: string
  icon: IconName
}

const CONFIG_META: Record<string, ConfigMeta> = {
  deposit_percent: { label: 'درصد پیش‌پرداخت', hint: 'سهم پیش‌پرداخت از قیمت نهایی خدمت', unit: '%', icon: 'invoice' },
  deposit_min_toman: { label: 'حداقل پیش‌پرداخت', hint: 'کف مبلغ پیش‌پرداخت، صرف‌نظر از درصد', unit: 'تومان', icon: 'wallet' },
  cancellation_window_hours: { label: 'مهلت لغو رزرو', hint: 'حداقل فاصله زمانی مجاز برای لغو رایگان', unit: 'ساعت', icon: 'history' },
  commission_percent: { label: 'درصد کمیسیون پلتفرم', hint: 'سهم پلتفرم از هر رزرو موفق', unit: '%', icon: 'invoice' },
  booking_hold_ttl_minutes: { label: 'مهلت نگه‌داری رزرو', hint: 'زمان قفل‌شدن نوبت تا پرداخت', unit: 'دقیقه', icon: 'calendar' },
  reminder_lead_hours: { label: 'یادآوری قبل از نوبت', hint: 'چند ساعت قبل، پیامک یادآوری ارسال شود', unit: 'ساعت', icon: 'bell' },
  review_edit_window_hours: { label: 'مهلت ویرایش نظر', hint: 'مدت زمانی که کاربر می‌تواند نظر ثبت‌شده را ویرایش یا حذف کند', unit: 'ساعت', icon: 'history' },
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
  booking_confirmed: 'تایید رزرو',
  booking_cancelled: 'لغو رزرو',
  payment_succeeded: 'پرداخت موفق',
  user_registered: 'ثبت‌نام کاربر',
  salon_submitted: 'ثبت سالن',
  search_performed: 'جستجو',
}

export function analyticsEventLabel(eventName: string): string {
  return ANALYTICS_EVENT[eventName] ?? eventName
}
