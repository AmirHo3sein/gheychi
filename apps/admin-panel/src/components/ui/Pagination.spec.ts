import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import Pagination from './Pagination.vue'

function mountPagination(props: { page: number; pageSize: number; total: number }) {
  return mount(Pagination, { props })
}

describe('Pagination', () => {
  it('renders nothing at all when there is nothing to page through', () => {
    expect(mountPagination({ page: 1, pageSize: 20, total: 0 }).find('div').exists()).toBe(false)
  })

  it('reports the current slice and clamps the end of a last, partial page', () => {
    expect(mountPagination({ page: 1, pageSize: 20, total: 45 }).get('p').text()).toBe('۱–۲۰ از ۴۵')
    expect(mountPagination({ page: 3, pageSize: 20, total: 45 }).get('p').text()).toBe('۴۱–۴۵ از ۴۵')
  })

  it('disables the edge buttons instead of emitting an out-of-range page', async () => {
    const onFirstPage = mountPagination({ page: 1, pageSize: 20, total: 45 })
    const [previous, next] = onFirstPage.findAll('button')
    expect(previous!.attributes('aria-label')).toBe('صفحه قبل')
    expect(next!.attributes('aria-label')).toBe('صفحه بعد')
    expect(previous!.attributes('disabled')).toBeDefined()

    await next!.trigger('click')
    expect(onFirstPage.emitted('update:page')).toEqual([[2]])

    const onLastPage = mountPagination({ page: 3, pageSize: 20, total: 45 })
    expect(onLastPage.findAll('button')[1]!.attributes('disabled')).toBeDefined()
  })

  // This bar is a SIBLING of each table's own overflow-x-auto scroller, so unlike the table it
  // has to FIT its card: every card that hosts it sets overflow-hidden for the rounded corners,
  // which clips the next-page button rather than scrolling to it. Wrapping onto a second line is
  // the only outcome that keeps both the range readout and the pager reachable when the content
  // column is narrow.
  it('wraps onto a second line rather than overflowing (and being clipped by) its card', () => {
    expect(mountPagination({ page: 1, pageSize: 20, total: 45 }).get('div').classes()).toContain('flex-wrap')
  })

  // App-wide floor -- h-11/w-11 is 44px. Pinned here because these two are the smallest
  // interactive controls in the admin panel and the easiest to shrink by accident.
  it('keeps both pager buttons at the 44px touch-target floor', () => {
    for (const button of mountPagination({ page: 2, pageSize: 20, total: 45 }).findAll('button')) {
      expect(button.classes()).toEqual(expect.arrayContaining(['h-11', 'w-11']))
    }
  })
})
