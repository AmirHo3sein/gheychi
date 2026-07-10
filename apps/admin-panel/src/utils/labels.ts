// apps/admin-panel/src/utils/labels.ts
// Central Farsi label maps for every enum the API returns raw. Every getter falls
// back to the raw value instead of throwing/blanking, so a new backend enum member
// or a new platform_config key shows up (in its raw form) rather than breaking.

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

export function userStatusLabel(status: string): LabelEntry {
  return USER_STATUS[status] ?? { label: status, tone: 'neutral' }
}

export function userRoleLabel(role: string): string {
  return USER_ROLE[role] ?? role
}

export function genderTargetLabel(gender: string): string {
  return GENDER_TARGET[gender] ?? gender
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
  'post.cover.set': { label: 'تغییر تصویر شاخص مطلب', tone: 'info' },
  'blogcategory.create': { label: 'ایجاد دسته‌بندی بلاگ', tone: 'success' },
  'blogcategory.update': { label: 'ویرایش دسته‌بندی بلاگ', tone: 'info' },
  'blogcategory.delete': { label: 'حذف دسته‌بندی بلاگ', tone: 'danger' },
}

// Canonical list of the audited action names -- filter dropdowns and tests derive from
// this export instead of re-declaring the action strings at every call site.
export const AUDIT_ACTION_KEYS = Object.keys(AUDIT_ACTION)

const AUDIT_TARGET_TYPE: Record<string, string> = {
  salon: 'آرایشگاه',
  user: 'کاربر',
  review: 'نظر',
  category: 'دسته‌بندی',
  config: 'تنظیمات',
  report: 'گزارش',
  post: 'مطلب بلاگ',
  blogcategory: 'دسته‌بندی بلاگ',
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
}

const CONFIG_META: Record<string, ConfigMeta> = {
  deposit_percent: { label: 'درصد پیش‌پرداخت', hint: 'سهم پیش‌پرداخت از قیمت نهایی خدمت', unit: '%' },
  deposit_min_toman: { label: 'حداقل پیش‌پرداخت', hint: 'کف مبلغ پیش‌پرداخت، صرف‌نظر از درصد', unit: 'تومان' },
  cancellation_window_hours: { label: 'مهلت لغو رزرو', hint: 'حداقل فاصله زمانی مجاز برای لغو رایگان', unit: 'ساعت' },
  commission_percent: { label: 'درصد کمیسیون پلتفرم', hint: 'سهم پلتفرم از هر رزرو موفق', unit: '%' },
  booking_hold_ttl_minutes: { label: 'مهلت نگه‌داری رزرو', hint: 'زمان قفل‌شدن نوبت تا پرداخت', unit: 'دقیقه' },
  reminder_lead_hours: { label: 'یادآوری قبل از نوبت', hint: 'چند ساعت قبل، پیامک یادآوری ارسال شود', unit: 'ساعت' },
}

/** Falls back to the raw key as its own label -- new config keys stay editable, just less pretty. */
export function configKeyMeta(key: string): ConfigMeta {
  return CONFIG_META[key] ?? { label: key, hint: '', unit: '' }
}
