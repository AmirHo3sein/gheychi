// ECharts renders to canvas and can't read CSS custom properties itself, so chart colours are
// resolved from the live design tokens in main.css at render time instead of keeping a second
// hex copy here that silently drifts whenever the palette changes. Callers re-read inside a
// computed that depends on `isDark`, so a theme switch re-resolves every colour.
//
// FALLBACK is used only where no stylesheet is applied (unit tests under happy-dom); it mirrors
// the light-theme brand tokens so a chart is never handed an empty colour string.
const FALLBACK: Record<ChartToken, string> = {
  '--color-text': '#2D2D2D',
  '--color-text-muted': '#5E5552',
  '--color-surface-card': '#FFFFFF',
  '--color-border': '#EADBD6',
  '--color-border-soft': '#F5ECE9',
  '--color-accent': '#FFC0B6',
  '--color-accent-text': '#A8473A',
  '--color-gold': '#D4AF37',
  '--color-silver': '#BDBDBD',
  '--tone-success-text': '#2E7D4F',
  '--tone-warning-text': '#8A5A00',
  '--tone-danger-text': '#B42318',
  '--tone-neutral-text': '#5E5552',
  '--tone-info-text': '#1F5F99',
}

export type ChartToken =
  | '--color-text'
  | '--color-text-muted'
  | '--color-surface-card'
  | '--color-border'
  | '--color-border-soft'
  | '--color-accent'
  | '--color-accent-text'
  | '--color-gold'
  | '--color-silver'
  | '--tone-success-text'
  | '--tone-warning-text'
  | '--tone-danger-text'
  | '--tone-neutral-text'
  | '--tone-info-text'

export function readToken(name: ChartToken): string {
  if (typeof window === 'undefined' || typeof getComputedStyle !== 'function') return FALLBACK[name]
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || FALLBACK[name]
}
