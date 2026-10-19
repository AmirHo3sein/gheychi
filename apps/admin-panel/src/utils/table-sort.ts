// Column sorting for the admin list tables. The API allowlists the sortable columns per list
// (AdminUserQueryDto / AdminSalonQueryDto / AdminBookingQueryDto `sort` + `order`); this is the
// client half: what a header click does, and the `aria-sort` it reports.
export type SortOrder = 'asc' | 'desc'
export const SORT_ORDERS: readonly SortOrder[] = ['asc', 'desc']

/**
 * A header click: the active column flips direction; another column becomes active in its
 * natural first direction (newest-first for dates, A→Z for text, cheapest-first for money).
 */
export function nextSort<F extends string>(
  current: { sort: F; order: SortOrder },
  field: F,
  firstOrder: SortOrder,
): { sort: F; order: SortOrder } {
  if (current.sort === field) return { sort: field, order: current.order === 'asc' ? 'desc' : 'asc' }
  return { sort: field, order: firstOrder }
}

export function ariaSort(active: boolean, order: SortOrder): 'ascending' | 'descending' | 'none' {
  if (!active) return 'none'
  return order === 'asc' ? 'ascending' : 'descending'
}
