// apps/admin-panel/src/utils/labels.spec.ts
import { describe, expect, it } from 'vitest'
import {
  AUDIT_ACTION_KEYS,
  AUDIT_TARGET_TYPE_KEYS,
  analyticsEventLabel,
  auditActionLabel,
  blogPostStatusLabel,
  bookingConfirmationModeLabel,
  bookingEventActorTypeLabel,
  bookingEventCauseLabel,
  bookingEventMetadataKeyLabel,
  bookingEventTypeLabel,
  bookingStatusLabel,
  configKeyMeta,
  invoicePaymentMethodLabel,
  invoiceStatusLabel,
  jalaliMonthLabel,
  qualifyingEventLabel,
  referralStatusLabel,
  referralTypeLabel,
  reportStatusLabel,
  reviewStatusLabel,
  rewardKindLabel,
  rewardKindUnit,
  showcaseStatusLabel,
  targetTypeLabel,
  workerRatingStatusLabel,
} from './labels'

describe('auditActionLabel', () => {
  it('maps every one of the audited actions to a Farsi label', () => {
    // 9 from Plan 7 + 6 post.* + 3 blogcategory.* from Plan 8 + 2 showcase
    // (story/portfolio status) from the salon-showcase plan + 1 wallet.adjust from the
    // referral-and-rating system's Slice 2 (Wallet Ledger) + 2 (referral-reward-type.update,
    // referral.cancel) from Slice 3 (Referral codes + tracking) + 3 coupon.* (create/update/
    // delete) + 1 worker-rating.moderate, both of which existed on the backend for a while
    // before the admin-panel audit-log sweep caught the drift and added their labels here.
    // post.cover.set was later split into two distinct backend actions (post.cover.upload /
    // post.cover.remove, Phase 1 audit-logging fix) so the two operations are distinguishable
    // in the audit log by action alone, net +1 to this count. 2 more (category-request.approve,
    // category-request.reject) were added with the category-request feature, and 2 more
    // (booking.approval.approved/rejected) with the manual booking-approval workflow.
    // 1 more (booking-settings.update) came with the optional manual booking-approval
    // workflow -- the admin-only per-salon approval/payment timeout overrides.
    // 14 more had accumulated on the backend without a label before the 2026-09 admin-panel
    // fix sweep caught the drift: feature-flags.update, invoice.payment.record,
    // salon.handle.set, and the monetization initiative's 3 plan.* + 3 subscription-coupon.*
    // + 2 subscription.billing-period.* + subscription.cancel/overrides.set/plan.set.
    // This length guard is deliberate: adding a backend @AuditAction without a Farsi label
    // must fail here.
    expect(AUDIT_ACTION_KEYS).toHaveLength(47)
    for (const action of AUDIT_ACTION_KEYS) {
      const entry = auditActionLabel(action)
      // A mapped entry never falls back to the raw dotted action name.
      expect(entry.label).not.toBe(action)
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })

  it('falls back to the raw value with a neutral tone for unknown actions', () => {
    expect(auditActionLabel('something.new')).toEqual({ label: 'something.new', tone: 'neutral' })
  })
})

// Pinned against the backend: every (action, targetType) pair below is a literal
// @AuditAction('<action>', '<targetType>') decorator in apps/api/src (grep for
// `@AuditAction(` there to refresh this list). The length guard above catches a label
// added or removed on THIS side; this catches the other direction -- a backend action that
// exists but would render as a raw dotted key in the audit-log table and be missing from
// the AuditLogView filter dropdown (built from AUDIT_ACTION_KEYS). Kept as a hardcoded list
// rather than read from the api source with fs, since no admin-panel test reaches across
// packages that way and the two apps deploy independently.
const BACKEND_AUDIT_ACTIONS: ReadonlyArray<readonly [action: string, targetType: string]> = [
  ['blogcategory.create', 'blogcategory'],
  ['blogcategory.delete', 'blogcategory'],
  ['blogcategory.update', 'blogcategory'],
  ['booking-settings.update', 'salon'],
  ['booking.approval.approved', 'booking'],
  ['booking.approval.rejected', 'booking'],
  ['category-request.approve', 'category-request'],
  ['category-request.reject', 'category-request'],
  ['category.create', 'category'],
  ['category.delete', 'category'],
  ['category.update', 'category'],
  ['config.update', 'config'],
  ['coupon.create', 'coupon'],
  ['coupon.delete', 'coupon'],
  ['coupon.update', 'coupon'],
  ['feature-flags.update', 'feature-flags'],
  ['invoice.payment.record', 'invoice'],
  ['plan.create', 'plan'],
  ['plan.delete', 'plan'],
  ['plan.update', 'plan'],
  ['post.cover.remove', 'post'],
  ['post.cover.upload', 'post'],
  ['post.create', 'post'],
  ['post.delete', 'post'],
  ['post.publish', 'post'],
  ['post.unpublish', 'post'],
  ['post.update', 'post'],
  ['referral-reward-type.update', 'referral-reward-type'],
  ['referral.cancel', 'referral'],
  ['report.resolve', 'report'],
  ['review.moderate', 'review'],
  ['salon.featured.set', 'salon'],
  ['salon.handle.set', 'salon'],
  ['salon.portfolio.status.set', 'portfolioitem'],
  ['salon.status.set', 'salon'],
  ['salon.story.status.set', 'story'],
  ['subscription-coupon.create', 'subscription-coupon'],
  ['subscription-coupon.delete', 'subscription-coupon'],
  ['subscription-coupon.update', 'subscription-coupon'],
  ['subscription.billing-period.create', 'subscription-billing-period'],
  ['subscription.billing-period.status.set', 'subscription-billing-period'],
  ['subscription.cancel', 'salon-subscription'],
  ['subscription.overrides.set', 'salon-subscription'],
  ['subscription.plan.set', 'salon-subscription'],
  ['user.status.set', 'user'],
  ['wallet.adjust', 'wallet'],
  ['worker-rating.moderate', 'worker-rating'],
]

describe('audit label coverage of the backend @AuditAction list', () => {
  it('every backend audit action has a Farsi label and is filterable', () => {
    const missing = BACKEND_AUDIT_ACTIONS.map(([action]) => action).filter((action) => !AUDIT_ACTION_KEYS.includes(action))
    expect(missing).toEqual([])
  })

  it('every backend audit target type has a Farsi label', () => {
    const targetTypes = [...new Set(BACKEND_AUDIT_ACTIONS.map(([, targetType]) => targetType))]
    const missing = targetTypes.filter((t) => !AUDIT_TARGET_TYPE_KEYS.includes(t))
    expect(missing).toEqual([])
    for (const t of targetTypes) expect(targetTypeLabel(t)).not.toBe(t)
  })

  it('has no label for an action the backend no longer emits (stale-label drift)', () => {
    const backendActions = BACKEND_AUDIT_ACTIONS.map(([action]) => action)
    const stale = AUDIT_ACTION_KEYS.filter((action) => !backendActions.includes(action))
    expect(stale).toEqual([])
  })
})

describe('targetTypeLabel', () => {
  it('falls back to the raw value for unknown target types', () => {
    expect(targetTypeLabel('something-new')).toBe('something-new')
  })
})

describe('blogPostStatusLabel', () => {
  it('maps the two blog post statuses', () => {
    expect(blogPostStatusLabel('draft')).toEqual({ label: 'پیش‌نویس', tone: 'neutral' })
    expect(blogPostStatusLabel('published')).toEqual({ label: 'منتشرشده', tone: 'success' })
  })

  it('falls back to the raw value for unknown statuses', () => {
    expect(blogPostStatusLabel('archived')).toEqual({ label: 'archived', tone: 'neutral' })
  })
})

describe('showcaseStatusLabel', () => {
  it('maps the two showcase content statuses shared by stories and portfolio items', () => {
    expect(showcaseStatusLabel('published')).toEqual({ label: 'منتشر شده', tone: 'success' })
    expect(showcaseStatusLabel('removed')).toEqual({ label: 'حذف شده', tone: 'danger' })
  })

  it('falls back to the raw value for unknown statuses', () => {
    expect(showcaseStatusLabel('expired')).toEqual({ label: 'expired', tone: 'neutral' })
  })
})

describe('workerRatingStatusLabel', () => {
  it("uses the rating's own status while the parent review is a live one", () => {
    expect(workerRatingStatusLabel('published', 'published')).toEqual(reviewStatusLabel('published'))
    expect(workerRatingStatusLabel('rejected', 'published')).toEqual(reviewStatusLabel('rejected'))
    // Parent rejected by an admin, rating still published: the rating's own state is what
    // the moderation screen is about, so nothing is overridden.
    expect(workerRatingStatusLabel('published', 'rejected')).toEqual(reviewStatusLabel('published'))
  })

  it("reports a withdrawn parent as the customer's own deletion, not an admin rejection", () => {
    // worker_ratings.status is cascaded to 'rejected' by ReviewsService.remove(), which is
    // indistinguishable from an admin rejection without the parent's status.
    expect(workerRatingStatusLabel('rejected', 'withdrawn')).toEqual({ label: 'حذف شده توسط کاربر', tone: 'neutral' })
  })
})

describe('bookingStatusLabel', () => {
  it('maps every member of the backend BookingStatus union to a Farsi label', () => {
    // All nine, including the two the manual-approval workflow added
    // (pending_approval, rejected_by_salon).
    const statuses = [
      'pending_approval', 'pending_payment', 'confirmed', 'completed',
      'cancelled_by_user', 'cancelled_by_salon', 'rejected_by_salon', 'expired', 'no_show',
    ]
    for (const status of statuses) {
      const entry = bookingStatusLabel(status)
      expect(entry.label).not.toBe(status)
      expect(entry.label.length).toBeGreaterThan(0)
    }
    expect(bookingStatusLabel('pending_approval')).toEqual({ label: 'در انتظار تایید آرایشگاه', tone: 'warning' })
    expect(bookingStatusLabel('rejected_by_salon')).toEqual({ label: 'رد شده توسط آرایشگاه', tone: 'danger' })
    // The two "someone cancelled" statuses must stay distinguishable, not collapse into
    // one label -- who cancelled is the whole point of the split on the backend.
    expect(bookingStatusLabel('cancelled_by_user').label).not.toBe(bookingStatusLabel('cancelled_by_salon').label)
  })

  it('never claims money moved for a booking that has no payment behind it yet', () => {
    // A pending_approval booking is a REQUEST -- nothing has been paid.
    expect(bookingStatusLabel('pending_approval').label).not.toContain('پرداخت')
  })

  it('falls back to the raw value for an unknown status', () => {
    expect(bookingStatusLabel('weird')).toEqual({ label: 'weird', tone: 'neutral' })
  })
})

describe('bookingConfirmationModeLabel', () => {
  it('maps the two owner-selected confirmation modes', () => {
    expect(bookingConfirmationModeLabel('automatic')).toEqual({ label: 'تایید خودکار', tone: 'success' })
    expect(bookingConfirmationModeLabel('manual_approval')).toEqual({ label: 'تایید دستی آرایشگاه', tone: 'info' })
  })

  it('falls back to the raw value for an unknown mode', () => {
    expect(bookingConfirmationModeLabel('weird')).toEqual({ label: 'weird', tone: 'neutral' })
  })
})

describe('bookingEventTypeLabel', () => {
  it('maps every booking_events.event_type the backend can write', () => {
    const eventTypes = [
      'BOOKING_CREATED', 'APPROVAL_REQUESTED', 'SALON_APPROVED', 'SALON_REJECTED',
      'APPROVAL_EXPIRED', 'PAYMENT_WINDOW_STARTED', 'PAYMENT_INITIATED', 'PAYMENT_SUCCEEDED',
      'PAYMENT_FAILED', 'PAYMENT_EXPIRED', 'BOOKING_CONFIRMED', 'SLOT_RELEASED',
      'BOOKING_CANCELLED', 'BOOKING_COMPLETED', 'BOOKING_NO_SHOW',
    ]
    for (const eventType of eventTypes) {
      const entry = bookingEventTypeLabel(eventType)
      expect(entry.label).not.toBe(eventType)
      expect(entry.label.length).toBeGreaterThan(0)
    }
  })

  it('falls back to the raw SCREAMING_CASE name for an unknown event type', () => {
    expect(bookingEventTypeLabel('SOMETHING_NEW')).toEqual({ label: 'SOMETHING_NEW', tone: 'neutral' })
  })
})

describe('bookingEventActorTypeLabel', () => {
  it('maps the four actor types, keeping the cron-driven one non-human', () => {
    expect(bookingEventActorTypeLabel('customer')).toBe('مشتری')
    expect(bookingEventActorTypeLabel('salon_owner')).toBe('آرایشگاه‌دار')
    expect(bookingEventActorTypeLabel('admin')).toBe('مدیر')
    expect(bookingEventActorTypeLabel('system')).toBe('سامانه')
  })

  it('falls back to the raw value for an unknown actor type', () => {
    expect(bookingEventActorTypeLabel('robot')).toBe('robot')
  })
})

describe('bookingEventMetadataKeyLabel / bookingEventCauseLabel', () => {
  it('prettifies the metadata keys the backend currently writes', () => {
    expect(bookingEventMetadataKeyLabel('approvalExpiresAt')).toBe('پایان مهلت تایید')
    expect(bookingEventMetadataKeyLabel('fromStatus')).toBe('وضعیت پیشین')
    expect(bookingEventCauseLabel('approval_expired')).toBe('اتمام مهلت تایید')
  })

  it('shows an unmapped key/cause raw rather than hiding it from the timeline', () => {
    expect(bookingEventMetadataKeyLabel('brandNewKey')).toBe('brandNewKey')
    expect(bookingEventCauseLabel('brand_new_cause')).toBe('brand_new_cause')
  })
})

describe('configKeyMeta', () => {
  // Without an entry the ConfigView row would render the raw snake_case key as its label.
  it('gives the manual-approval timeout config key a Farsi label, hint and unit', () => {
    const meta = configKeyMeta('booking_approval_timeout_minutes')
    expect(meta.label).toBe('مهلت تایید درخواست رزرو')
    expect(meta.unit).toBe('دقیقه')
    expect(meta.hint.length).toBeGreaterThan(0)
  })

  it('falls back to the raw key for an unknown config key', () => {
    expect(configKeyMeta('brand_new_key').label).toBe('brand_new_key')
  })
})

describe('reportStatusLabel', () => {
  it('maps the three report statuses', () => {
    expect(reportStatusLabel('open')).toEqual({ label: 'باز', tone: 'warning' })
    expect(reportStatusLabel('resolved')).toEqual({ label: 'رسیدگی شده', tone: 'success' })
    expect(reportStatusLabel('dismissed')).toEqual({ label: 'رد شده', tone: 'neutral' })
  })

  it('falls back to the raw value for unknown statuses', () => {
    expect(reportStatusLabel('weird')).toEqual({ label: 'weird', tone: 'neutral' })
  })
})

describe('referralStatusLabel', () => {
  it('maps the five referral statuses', () => {
    expect(referralStatusLabel('awaiting_qualifying_event')).toEqual({ label: 'در انتظار رویداد', tone: 'warning' })
    // 'partially_granted' (Slice 4): one beneficiary side got its (wallet-kind) reward,
    // the other side's kind isn't grantable until slice 5 -- a real, reachable status,
    // not a placeholder (referral.entity.ts's ReferralStatus doc comment).
    expect(referralStatusLabel('partially_granted')).toEqual({ label: 'اعطای جزئی پاداش', tone: 'info' })
    expect(referralStatusLabel('reward_granted')).toEqual({ label: 'پاداش اعطا شد', tone: 'success' })
    expect(referralStatusLabel('expired')).toEqual({ label: 'منقضی شده', tone: 'neutral' })
    expect(referralStatusLabel('cancelled')).toEqual({ label: 'لغو شده', tone: 'danger' })
  })

  it('falls back to the raw value for unknown statuses', () => {
    expect(referralStatusLabel('weird')).toEqual({ label: 'weird', tone: 'neutral' })
  })
})

describe('referralTypeLabel', () => {
  it('maps the three referral types', () => {
    expect(referralTypeLabel('user')).toBe('کاربر عادی')
    expect(referralTypeLabel('salon_owner')).toBe('صاحب سالن')
    expect(referralTypeLabel('worker')).toBe('کارمند')
  })

  it('falls back to the raw value for an unknown type', () => {
    expect(referralTypeLabel('weird')).toBe('weird')
  })
})

describe('rewardKindLabel / rewardKindUnit', () => {
  it('maps every reward kind to a Farsi label and the correct unit', () => {
    expect(rewardKindLabel('wallet_credit')).toBe('اعتبار کیف پول')
    expect(rewardKindUnit('wallet_credit')).toBe('تومان')
    expect(rewardKindLabel('percent_discount')).toBe('تخفیف درصدی')
    expect(rewardKindUnit('percent_discount')).toBe('٪')
    expect(rewardKindLabel('fixed_discount')).toBe('تخفیف مبلغ ثابت')
    expect(rewardKindUnit('fixed_discount')).toBe('تومان')
    expect(rewardKindLabel('cashback')).toBe('بازگشت وجه')
    expect(rewardKindUnit('cashback')).toBe('تومان')
    expect(rewardKindLabel('loyalty_points')).toBe('امتیاز وفاداری')
    expect(rewardKindUnit('loyalty_points')).toBe('امتیاز')
  })
})

describe('qualifyingEventLabel', () => {
  it('maps the two qualifying events', () => {
    expect(qualifyingEventLabel('first_completed_booking')).toBe('اولین نوبت تکمیل‌شده')
    expect(qualifyingEventLabel('first_paid_booking')).toBe('اولین نوبت پرداخت‌شده')
  })

  it('falls back to the raw value for an unknown event', () => {
    expect(qualifyingEventLabel('weird')).toBe('weird')
  })
})

describe('invoiceStatusLabel', () => {
  it('maps every invoice status to a Farsi label and tone', () => {
    expect(invoiceStatusLabel('issued')).toEqual({ label: 'صادرشده', tone: 'info' })
    expect(invoiceStatusLabel('partially_paid')).toEqual({ label: 'پرداخت جزئی', tone: 'warning' })
    expect(invoiceStatusLabel('paid')).toEqual({ label: 'پرداخت‌شده', tone: 'success' })
    expect(invoiceStatusLabel('void')).toEqual({ label: 'باطل‌شده', tone: 'neutral' })
  })

  it('falls back to the raw value for an unknown status', () => {
    expect(invoiceStatusLabel('weird')).toEqual({ label: 'weird', tone: 'neutral' })
  })
})

describe('invoicePaymentMethodLabel', () => {
  it('maps every payment method to a Farsi label', () => {
    expect(invoicePaymentMethodLabel('bank_transfer')).toBe('حواله بانکی')
    expect(invoicePaymentMethodLabel('cash')).toBe('نقدی')
    expect(invoicePaymentMethodLabel('other')).toBe('سایر')
  })

  it('falls back to the raw value for an unknown method', () => {
    expect(invoicePaymentMethodLabel('weird')).toBe('weird')
  })
})

describe('jalaliMonthLabel', () => {
  it('formats a Jalali (year, month) pair with Persian digits and the Persian month name', () => {
    expect(jalaliMonthLabel(1403, 1)).toBe('فروردین ۱۴۰۳')
    expect(jalaliMonthLabel(1403, 12)).toBe('اسفند ۱۴۰۳')
  })

  it('does not insert a thousands separator into the year', () => {
    expect(jalaliMonthLabel(1403, 7)).not.toContain('٬')
  })
})

describe('analyticsEventLabel', () => {
  it('maps every event_name the backend currently tracks to a Farsi label', () => {
    expect(analyticsEventLabel('booking_started')).toBe('شروع رزرو')
    expect(analyticsEventLabel('booking_confirmed')).toBe('تایید رزرو')
    expect(analyticsEventLabel('booking_cancelled')).toBe('لغو رزرو')
    expect(analyticsEventLabel('payment_succeeded')).toBe('پرداخت موفق')
    expect(analyticsEventLabel('user_registered')).toBe('ثبت‌نام کاربر')
    expect(analyticsEventLabel('salon_submitted')).toBe('ثبت سالن')
    expect(analyticsEventLabel('search_performed')).toBe('جستجو')
  })

  it('falls back to the raw event name for an unknown event', () => {
    expect(analyticsEventLabel('weird_event')).toBe('weird_event')
  })
})
