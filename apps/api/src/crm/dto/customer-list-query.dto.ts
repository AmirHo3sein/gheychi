import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** Sort keys the customer list accepts. The VALUES are SQL fragments and must never be
 *  caller-supplied -- `sort` is `@IsIn`-validated against these keys and then used as a
 *  lookup into this frozen map, so nothing a client sends can reach the ORDER BY text. */
export const CUSTOMER_SORTS = {
  /** Most recently seen in the salon first. Customers who have never actually visited
   *  (only future or cancelled bookings) sort last rather than first, which is what
   *  `NULLS LAST` buys over Postgres' default `NULLS FIRST` on a DESC sort. */
  recent: 'last_visit_at DESC NULLS LAST',
  bookings: 'bookings_count DESC',
  value: 'gross_value DESC',
  name: 'name ASC NULLS LAST',
} as const;

export type CustomerSort = keyof typeof CUSTOMER_SORTS;

export class CustomerListQueryDto {
  /**
   * Free-text search over the customer's name and phone. Trimmed before validation (the
   * same trim-then-validate ordering the referral system's admin wallet-adjustment reason
   * needed, so a whitespace-only value can't slip through as "present"), length-capped
   * because it is expanded into an `ILIKE '%...%'` pattern.
   */
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsIn(['new', 'returning', 'lapsed'])
  segment?: 'new' | 'returning' | 'lapsed';

  @IsOptional()
  @IsIn(Object.keys(CUSTOMER_SORTS))
  sort?: CustomerSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // Max 100, matching AdminSalonQueryDto/AdminUserQueryDto -- one pagination shape across
  // every list endpoint in this codebase.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
