import { describe, expect, it } from 'vitest'
import { ariaSort, nextSort } from './table-sort'

describe('table sort', () => {
  it('flips the active column and starts another column in its natural direction', () => {
    expect(nextSort({ sort: 'name', order: 'asc' }, 'name', 'asc')).toEqual({ sort: 'name', order: 'desc' })
    expect(nextSort({ sort: 'name', order: 'desc' }, 'name', 'asc')).toEqual({ sort: 'name', order: 'asc' })
    expect(nextSort({ sort: 'name', order: 'asc' }, 'createdAt', 'desc')).toEqual({ sort: 'createdAt', order: 'desc' })
  })

  it('reports aria-sort only on the active column', () => {
    expect(ariaSort(false, 'asc')).toBe('none')
    expect(ariaSort(true, 'asc')).toBe('ascending')
    expect(ariaSort(true, 'desc')).toBe('descending')
  })
})
