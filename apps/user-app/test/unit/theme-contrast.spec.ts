import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The status badges («انجام شده», «لغو شده», …) are 12px bold text on their own -soft tint, so
// each text/tint pair has to clear WCAG AA's 4.5:1 for normal-size text in BOTH themes. This reads
// the real tokens -- the shared @gheychi/brand-tokens file first, then this app's main.css on top,
// the same order the stylesheet applies them -- so a palette change that breaks a pair fails here.
const sharedCss = readFileSync(resolve(__dirname, '../../../../packages/brand-tokens/tokens.css'), 'utf8')
const appCss = readFileSync(resolve(__dirname, '../../app/assets/css/main.css'), 'utf8')

function block(css: string, selector: RegExp): string {
  const m = css.match(selector)
  if (!m) throw new Error(`no block for ${selector}`)
  return m[1]!
}
function colours(src: string): Record<string, string> {
  return Object.fromEntries([...src.matchAll(/--color-([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1]!, m[2]!]))
}
const THEME = /@theme static \{([\s\S]*?)\n\}/
const DARK = /\n\.dark \{([\s\S]*?)\n\}/
const light = { ...colours(block(sharedCss, THEME)), ...colours(block(appCss, THEME)) }
// A token the dark blocks don't redefine inherits the light value, exactly as in the browser.
const dark = { ...light, ...colours(block(sharedCss, DARK)), ...colours(block(appCss, DARK)) }

function token(resolved: Record<string, string>, name: string): string {
  const v = resolved[name]
  if (!v) throw new Error(`token --color-${name} not found`)
  return v
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
  for (const [theme, src] of [['light', light], ['dark', dark]] as const) {
    for (const [fg, bg] of PAIRS) {
      it(`${theme}: --color-${fg} on --color-${bg} >= 4.5`, () => {
        expect(contrast(token(src, fg), token(src, bg))).toBeGreaterThanOrEqual(4.5)
      })
    }
  }
})
