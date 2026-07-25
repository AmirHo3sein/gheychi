// apps/admin-panel/src/utils/labels.spec.ts
import { describe, expect, it } from 'vitest'
import {
  AUDIT_ACTION_KEYS,
  auditActionLabel,
  blogPostStatusLabel,
  qualifyingEventLabel,
  referralStatusLabel,
  referralTypeLabel,
  reportStatusLabel,
  rewardKindLabel,
  rewardKindUnit,
  showcaseStatusLabel,
} from './labels'

describe('auditActionLabel', () => {
  it('maps every one of the audited actions to a Farsi label', () => {
    // 9 from Plan 7 + 6 post.* + 3 blogcategory.* from Plan 8 + 2 showcase
    // (story/portfolio status) from the salon-showcase plan + 1 wallet.adjust from the
    // referral-and-rating system's Slice 2 (Wallet Ledger) + 2 (referral-reward-type.update,
    // referral.cancel) from Slice 3 (Referral codes + tracking) + 3 coupon.* (create/update/
    // delete) + 1 worker-rating.moderate, both of which existed on the backend for a while
    // before the admin-panel audit-log sweep caught the drift and added their labels here.
    // This length guard is deliberate: adding a backend @AuditAction without a Farsi label
    // must fail here.
    expect(AUDIT_ACTION_KEYS).toHaveLength(27)
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
