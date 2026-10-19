import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SortableTh from './SortableTh.vue'

function mountTh(props: Record<string, unknown>) {
  return mount({ components: { SortableTh }, props: ['p'], template: '<table><thead><tr><SortableTh v-bind="p" @sort="(v) => $emit(\'sort\', v)" /></tr></thead></table>' }, { props: { p: props } })
}

describe('SortableTh', () => {
  it('is a keyboard-reachable button inside a th that reports aria-sort', () => {
    const w = mountTh({ label: 'نام', field: 'name', sort: 'name', order: 'desc' })
    expect(w.get('th').attributes('aria-sort')).toBe('descending')
    expect(w.get('th button').text()).toContain('نام')
    const inactive = mountTh({ label: 'شهر', field: 'city', sort: 'name', order: 'desc' })
    expect(inactive.get('th').attributes('aria-sort')).toBe('none')
  })

  it('emits the next sort on click: flip when active, first direction otherwise', async () => {
    const active = mountTh({ label: 'نام', field: 'name', sort: 'name', order: 'asc' })
    await active.get('button').trigger('click')
    expect(active.findComponent(SortableTh).emitted('sort')![0]).toEqual([{ sort: 'name', order: 'desc' }])

    const other = mountTh({ label: 'تاریخ', field: 'createdAt', sort: 'name', order: 'asc', firstOrder: 'desc' })
    await other.get('button').trigger('click')
    expect(other.findComponent(SortableTh).emitted('sort')![0]).toEqual([{ sort: 'createdAt', order: 'desc' }])
  })
})
