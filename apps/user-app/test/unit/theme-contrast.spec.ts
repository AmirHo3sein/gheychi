import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The status badges («انجام شده», «لغو شده», …) are 12px bold text on their own -soft tint, so
// each text/tint pair has to clear WCAG AA's 4.5:1 for normal-size text in BOTH themes. This reads
// the real tokens out of main.css, so a palette change that breaks a pair fails here.
const css = readFileSync(resolve(__dirname, '../../app/assets/css/main.css'), 'utf8')

function block(selector: RegExp): string {
  const m = css.match(selector)
  if (!m) throw new Error(`no block for ${selector}`)
  return m[1]!
}
const lightBlock = block(/@theme static \{([\s\S]*?)\n\}/)
const darkBlock = block(/\n\.dark \{([\s\S]*?)\n\}/)

// A token the dark block doesn't redefine inherits the light value, exactly as in the browser.
function token(src: string, name: string): string {
  const re = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`)
  const m = src.match(re) ?? lightBlock.match(re)
  if (!m) throw new Error(`token --color-${name} not found`)
  return m[1]!
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi! + 0.05) / (lo! + 0.05)
}

const PAIRS: Array<[string, string]> = [
  ['success-text', 'success-soft'],
  ['success-text', 'surface'],
  ['success-text', 'surface-card'],
  ['danger', 'danger-soft'],
  ['text', 'accent-soft'],
  ['text-muted', 'surface-subtle'],
  ['accent-text', 'surface'],
  ['accent-text', 'surface-card'],
  ['fill-text', 'accent'],
]

describe('theme token contrast (WCAG AA, normal text)', () => {
  for (const [theme, src] of [['light', lightBlock], ['dark', darkBlock]] as const) {
    for (const [fg, bg] of PAIRS) {
      it(`${theme}: --color-${fg} on --color-${bg} >= 4.5`, () => {
        expect(contrast(token(src, fg), token(src, bg))).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})
