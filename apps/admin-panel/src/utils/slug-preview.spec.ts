import { describe, expect, it } from 'vitest'
import { previewSlug } from './slug-preview'

describe('previewSlug', () => {
  it('keeps Persian letters and dashes the word gaps (no transliteration)', () => {
    expect(previewSlug('راهنمای مراقبت از مو')).toBe('راهنمای-مراقبت-از-مو')
  })

  it('lowercases Latin and strips symbols', () => {
    expect(previewSlug('Top 10 Hair Tips!')).toBe('top-10-hair-tips')
  })

  it('collapses dash runs and trims edge dashes', () => {
    expect(previewSlug('  سلام -- دنیا  ')).toBe('سلام-دنیا')
  })

  it('turns ZWNJ (نیم‌فاصله) into a dash', () => {
    expect(previewSlug('می‌خواهم')).toBe('می-خواهم')
  })
})
