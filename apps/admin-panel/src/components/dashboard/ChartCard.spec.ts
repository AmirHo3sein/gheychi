import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ChartCard from './ChartCard.vue'

const base = { title: 'عنوان', subtitle: 'زیرعنوان', loading: false, error: false, empty: false }
const mountCard = (props: Partial<typeof base & { emptyMessage: string }> = {}) =>
  mount(ChartCard, { props: { ...base, ...props }, slots: { default: '<div data-testid="chart">chart</div>' } })

describe('ChartCard', () => {
  it('renders title, subtitle and the chart when ready', () => {
    const wrapper = mountCard()
    expect(wrapper.text()).toContain('عنوان')
    expect(wrapper.text()).toContain('زیرعنوان')
    expect(wrapper.find('[data-testid="chart"]').exists()).toBe(true)
  })

  it('shows a status-labelled skeleton instead of the chart while loading', () => {
    const wrapper = mountCard({ loading: true })
    const loading = wrapper.get('[data-testid="chart-loading"]')
    expect(loading.attributes('role')).toBe('status')
    expect(wrapper.find('[data-testid="chart"]').exists()).toBe(false)
  })

  it('shows the error state, which wins over empty', () => {
    const wrapper = mountCard({ error: true, empty: true })
    expect(wrapper.find('[data-testid="chart-error"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="chart"]').exists()).toBe(false)
  })

  it('shows the default or a custom empty message', () => {
    expect(mountCard({ empty: true }).text()).toContain('داده‌ای برای نمایش موجود نیست.')
    expect(mountCard({ empty: true, emptyMessage: 'هنوز نظری ثبت نشده است.' }).text()).toContain('هنوز نظری ثبت نشده است.')
  })
})
