import { describe, it, expect } from 'vitest'
import {
  attributeKeysForDomain, conceptLabel, confidenceLabel, failureMessage, formatDurationEstimate, guideImageUrl,
  isDrivingMatch, isUuid, type GuideConcept,
} from '../../app/utils/beauty-guide'

const concept = (over: Partial<GuideConcept>): GuideConcept => ({
  key: 'balayage', nameFa: 'بالیاژ', nameEn: 'Balayage', domain: 'hair_color', confidence: 'high', source: 'ai',
  removed: false, evidenceFa: null, mappable: true, ...over,
})

describe('beauty guide helpers', () => {
  it('words confidence as a possibility, never a fact', () => {
    expect(confidenceLabel(concept({ confidence: 'high' }))).toBe('به احتمال زیاد')
    expect(confidenceLabel(concept({ confidence: 'medium' }))).toBe('احتمالاً')
    expect(confidenceLabel(concept({ confidence: 'low' }))).toBe('شاید')
    expect(confidenceLabel(concept({ source: 'user' }))).toBe('انتخاب شما')
  })

  it('renders the professional term Persian-first with the English in parentheses', () => {
    expect(conceptLabel(concept({}))).toBe('بالیاژ (Balayage)')
  })

  it('only lets confident or customer-confirmed concepts drive matching', () => {
    expect(isDrivingMatch(concept({ confidence: 'high' }))).toBe(true)
    expect(isDrivingMatch(concept({ confidence: 'low' }))).toBe(false)
    expect(isDrivingMatch(concept({ confidence: 'low', source: 'user' }))).toBe(true)
    expect(isDrivingMatch(concept({ removed: true }))).toBe(false)
  })

  it('formats informational duration estimates', () => {
    expect(formatDurationEstimate({ min: 180, max: 300 })).toBe('حدود ۳ تا ۵ ساعت')
    expect(formatDurationEstimate({ min: 60, max: 120 })).toBe('حدود ۶۰ تا ۱۲۰ دقیقه')
    expect(formatDurationEstimate({ min: 45, max: 45 })).toBe('حدود ۴۵ دقیقه')
  })

  it('offers domain-relevant attributes for correction', () => {
    expect(attributeKeysForDomain('nails')).toEqual(['nail_shape', 'nail_length', 'finish'])
    expect(attributeKeysForDomain('hair_color')).toContain('hair_length')
    expect(attributeKeysForDomain('makeup')).toEqual([])
  })

  it('maps failure codes to honest messages', () => {
    expect(failureMessage('timeout')).toContain('طول کشید')
    expect(failureMessage(null)).toBe('ساخت راهنما ناموفق بود.')
    // Busy / unreachable providers tell the customer their quota wasn't spent.
    expect(failureMessage('provider_busy')).toContain('شلوغ')
    expect(failureMessage('provider_busy')).toContain('سهمیه')
    expect(failureMessage('provider_unreachable')).toContain('برقرار نشد')
  })

  it('builds the private image URL against the API base and validates ids', () => {
    expect(guideImageUrl('http://localhost:3002/api/', '/beauty-guides/x/image')).toBe('http://localhost:3002/api/beauty-guides/x/image')
    expect(isUuid('0b6c1e57-2f0a-4c1e-9b1e-1d2c3e4f5a6b')).toBe(true)
    expect(isUuid('../../etc')).toBe(false)
    expect(isUuid(['0b6c1e57-2f0a-4c1e-9b1e-1d2c3e4f5a6b'])).toBe(false)
  })
})
