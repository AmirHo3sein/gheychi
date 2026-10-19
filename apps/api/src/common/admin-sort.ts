/**
 * Column sorting for the admin list screens (users, salons, bookings). Each list names the
 * columns it allows in its own DTO (`@IsIn`) and maps them to fixed SQL columns in its
 * own query, so a client value is never interpolated into SQL. Every sorted query also adds a
 * unique tiebreaker (the row id) so equal values cannot swap places between pages.
 */
export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export function sqlOrder(order: SortOrder | undefined, fallback: 'ASC' | 'DESC'): 'ASC' | 'DESC' {
  if (order === 'asc') return 'ASC';
  if (order === 'desc') return 'DESC';
  return fallback;
}
