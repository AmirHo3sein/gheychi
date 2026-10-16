import { describe, expect, it } from 'vitest'
import { highlightMatch } from '../../app/utils/highlight-match'

describe('highlightMatch', () => {
  it('marks the typed fragment inside the name', () => {
    expect(highlightMatch('سالن زیبایی ستاره', 'ستاره')).toEqual([
      { text: 'سالن زیبایی ', match: false },
      { text: 'ستاره', match: true },
    ])
  })

  it('matches Arabic ي/ك typing against a Persian name, keeping the original letters', () => {
    expect(highlightMatch('آرایشگاه کوثر', 'كوثر')).toEqual([
      { text: 'آرایشگاه ', match: false },
      { text: 'کوثر', match: true },
    ])
  })

  it('is case-insensitive for Latin names and ignores surrounding spaces', () => {
    expect(highlightMatch('Near Salon', '  salon ')).toEqual([
      { text: 'Near ', match: false },
      { text: 'Salon', match: true },
    ])
  })

  it('returns the name unmarked when nothing matches or nothing was typed', () => {
    expect(highlightMatch('ستاره', 'ماه')).toEqual([{ text: 'ستاره', match: false }])
    expect(highlightMatch('ستاره', '   ')).toEqual([{ text: 'ستاره', match: false }])
  })
})
