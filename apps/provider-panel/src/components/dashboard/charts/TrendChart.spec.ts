import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import TrendChart, { type TrendPoint } from './TrendChart.vue'

function points(values: number[]): TrendPoint[] {
  return values.map((value, i) => ({ key: `d${i}`, label: `روز ${i}`, longLabel: `روز ${i}`, value }))
}

function mountChart(values: number[]) {
  return mount(TrendChart, {
    props: { points: points(values), seriesLabel: 'نوبت‌ها', formatValue: (v: number) => `${v}`, integer: true, caption: 'روند' },
  })
}

// SVG text inherits the page's RTL direction, which mirrors text-anchor ("start" = the text's
// right end). The edge labels must grow AWAY from the edge they sit on: the oldest day is at the
// right edge, today at the left, and the value axis hugs the right edge.
describe('TrendChart RTL labels', () => {
  it('anchors the oldest date to grow leftward and the newest to grow rightward, so neither is clipped', () => {
    const w = mountChart([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    const dates = w.findAll('svg text').filter((t) => t.text().startsWith('روز'))
    const first = dates.find((t) => t.text() === 'روز 0')!
    const last = dates.find((t) => t.text() === 'روز 9')!
    expect(first.attributes('text-anchor')).toBe('start')
    expect(last.attributes('text-anchor')).toBe('end')
  })

  it('anchors the value axis labels to grow leftward from the right edge', () => {
    const w = mountChart([0, 3, 8])
    const axis = w.findAll('svg text').filter((t) => !t.text().startsWith('روز'))
    expect(axis.length).toBeGreaterThan(1)
    for (const t of axis) expect(t.attributes('text-anchor')).toBe('start')
  })

  it('shows only the zero baseline when nothing was recorded, not an invented 0-4 scale', () => {
    const w = mountChart([0, 0, 0])
    const axis = w.findAll('svg text').filter((t) => !t.text().startsWith('روز'))
    expect(axis.map((t) => t.text())).toEqual(['۰'])
    expect(w.find('[data-testid="trend-empty"]').exists()).toBe(true)
  })
})
