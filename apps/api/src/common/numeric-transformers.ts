/**
 * TypeORM column transformers for numeric-ish Postgres types that the `pg` driver returns
 * as JS strings by default (both `bigint` and `numeric` -- Postgres numeric types can
 * exceed JS's safe-integer/float precision, so `pg` never auto-coerces them).
 *
 * Two distinctly-named pairs, not one generic pair, even though the logic is identical:
 * `bigintToNumber` documents "this column is a Postgres `bigint`" and `numericToNumber`
 * documents "this column is a Postgres `numeric(p,s)`" at every call site -- that's a real
 * readability signal for anyone auditing precision/rounding behavior on a given column,
 * worth keeping even though the underlying implementation is the same `Number(v)` coercion
 * either way. Every money-amount and every referral-reward-value column in this schema
 * used to define its own private copy of one of these two pairs; this file is the single
 * source of truth all of them now import from.
 */

export const bigintToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

/**
 * Same as bigintToNumber, but null-safe -- for a bigint column that's genuinely nullable
 * (e.g. a discount amount that's only ever set when a discount actually applied), `from`
 * must pass a null straight through rather than coercing it to 0 via Number(null).
 */
export const nullableBigintToNumber = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};

export const numericToNumber = {
  to: (v: number) => v,
  from: (v: string) => Number(v),
};

export const nullableNumericToNumber = {
  to: (v: number | null) => v,
  from: (v: string | null) => (v === null ? null : Number(v)),
};
