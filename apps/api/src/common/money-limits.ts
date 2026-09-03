/**
 * Upper bound for any toman amount a client may submit (a service price, a search price
 * filter). Far above any real salon price (1e9 toman) yet far below bigint's 9.2e18, so a
 * hostile or fat-fingered value fails DTO validation with a 400 instead of overflowing a
 * ::bigint bind and surfacing as a 500 -- the DTO layer, not Postgres, is the boundary.
 */
export const MAX_PRICE_TOMAN = 1_000_000_000;
