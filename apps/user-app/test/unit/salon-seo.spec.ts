import { describe, it, expect } from 'vitest'
import { plainTextExcerpt, resolveSalonDescription } from '../../app/utils/salon-seo'

const BASE = {
  name: 'سالن نمونه',
  address: 'خیابان ولیعصر',
  description: 'توضیح قدیمی',
  tagline: 'زیبایی با ما',
  about: 'درباره سالن ما\nبا دو خط متن',
}

describe('plainTextExcerpt', () => {
  it('collapses whitespace (including newlines) into single spaces', () => {
    expect(plainTextExcerpt('خط اول\n\nخط  دوم\tادامه')).toBe('خط اول خط دوم ادامه')
  })

  it('returns short text unchanged after trimming', () => {
    expect(plainTextExcerpt('  متن کوتاه  ')).toBe('متن کوتاه')
  })

  it('truncates long text at a word boundary with an ellipsis', () => {
    const word = 'کلمه'
    const text = Array(60).fill(word).join(' ') // 60*5-1 = 299 code points
    const result = plainTextExcerpt(text)
    expect(result.endsWith('…')).toBe(true)
    expect(Array.from(result).length).toBeLessThanOrEqual(161)
    // Never cuts mid-word: everything before the ellipsis is whole words.
    expect(result.slice(0, -1).split(' ').every((w) => w === word)).toBe(true)
  })

  it('counts code points, not UTF-16 units, so surrogate pairs never split', () => {
    const emoji = '😀'.repeat(200) // 200 code points, 400 UTF-16 units, no spaces
    const result = plainTextExcerpt(emoji)
    expect(Array.from(result).length).toBe(161) // 160 emoji + ellipsis
    expect(result.at(-1)).toBe('…')
    expect(Array.from(result.slice(0, -1)).every((p) => p === '😀')).toBe(true)
  })
})

describe('resolveSalonDescription', () => {
  it('prefers the about excerpt over everything else', () => {
    expect(resolveSalonDescription(BASE)).toBe('درباره سالن ما با دو خط متن')
  })

  it('falls back to tagline when about is null', () => {
    expect(resolveSalonDescription({ ...BASE, about: null })).toBe('زیبایی با ما')
  })

  it('falls back through an all-whitespace about (|| semantics, not ??)', () => {
    expect(resolveSalonDescription({ ...BASE, about: '  \n  ' })).toBe('زیبایی با ما')
  })

  it('falls back to description when about and tagline are null', () => {
    expect(resolveSalonDescription({ ...BASE, about: null, tagline: null })).toBe('توضیح قدیمی')
  })

  it('falls back to name—address when all three are null', () => {
    expect(resolveSalonDescription({ ...BASE, about: null, tagline: null, description: null }))
      .toBe('سالن نمونه — خیابان ولیعصر')
  })

  it('truncates a long about to the excerpt length', () => {
    const about = 'توضیح '.repeat(100)
    const result = resolveSalonDescription({ ...BASE, about })
    expect(result.endsWith('…')).toBe(true)
    expect(Array.from(result).length).toBeLessThanOrEqual(161)
  })
})
