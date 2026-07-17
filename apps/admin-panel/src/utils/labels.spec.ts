// apps/admin-panel/src/utils/labels.spec.ts
import { describe, expect, it } from 'vitest'
import { AUDIT_ACTION_KEYS, auditActionLabel, blogPostStatusLabel, reportStatusLabel, showcaseStatusLabel } from './labels'

describe('auditActionLabel', () => {
  it('maps every one of the twenty audited actions to a Farsi label', () => {
    // 9 from Plan 7 + 6 post.* + 3 blogcategory.* from Plan 8 + 2 showcase
    // (story/portfolio status) from the salon-showcase plan. This length guard is
    // deliberate: adding a backend @AuditAction without a Farsi label must fail here.
    expect(AUDIT_ACTION_KEYS).toHaveLength(20)
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
