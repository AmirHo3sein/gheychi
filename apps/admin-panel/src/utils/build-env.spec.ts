import { describe, expect, it } from 'vitest'
import { buildEnv } from './build-env'

describe('buildEnv', () => {
  it('uses the configured value when one is really set', () => {
    expect(buildEnv('https://api.gheychi.co/api', 'http://localhost:3002/api')).toBe('https://api.gheychi.co/api')
  })

  it('falls back when the variable is undefined', () => {
    expect(buildEnv(undefined, 'http://localhost:3002/api')).toBe('http://localhost:3002/api')
  })

  it('falls back on an EMPTY string -- an unset CI repo variable expands to exactly this', () => {
    expect(buildEnv('', 'http://localhost:3002/api')).toBe('http://localhost:3002/api')
  })

  it('falls back on a whitespace-only value', () => {
    expect(buildEnv('   ', 'http://localhost:3002/api')).toBe('http://localhost:3002/api')
  })

  it('trims a stray trailing newline rather than baking it into every URL', () => {
    expect(buildEnv('https://api.gheychi.co/api\n', 'http://localhost:3002/api')).toBe('https://api.gheychi.co/api')
  })
})
