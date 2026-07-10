// apps/admin-panel/src/utils/labels.spec.ts
import { describe, expect, it } from 'vitest'
import { AUDIT_ACTION_KEYS, auditActionLabel, reportStatusLabel } from './labels'

describe('auditActionLabel', () => {
  it('maps every one of the nine audited actions to a Farsi label', () => {
    expect(AUDIT_ACTION_KEYS).toHaveLength(9)
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
