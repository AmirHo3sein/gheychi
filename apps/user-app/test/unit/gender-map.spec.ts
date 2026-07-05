import { describe, it, expect } from 'vitest'
import { toSearchGender } from '../../app/utils/gender-map'

describe('toSearchGender', () => {
  it('maps female to women', () => {
    expect(toSearchGender('female')).toBe('women')
  })

  it('maps male to men', () => {
    expect(toSearchGender('male')).toBe('men')
  })

  it('maps null/undefined to undefined', () => {
    expect(toSearchGender(null)).toBeUndefined()
    expect(toSearchGender(undefined)).toBeUndefined()
  })
})
