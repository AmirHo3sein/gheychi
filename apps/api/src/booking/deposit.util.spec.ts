import { calculateDeposit } from './deposit.util';

describe('calculateDeposit', () => {
  it('takes the percentage of price when it exceeds the minimum', () => {
    expect(calculateDeposit(2000000, 20, 200000)).toBe(400000);
  });

  it('falls back to the minimum when the percentage would be lower', () => {
    expect(calculateDeposit(500000, 20, 200000)).toBe(200000);
  });

  it('rounds to the nearest whole toman', () => {
    expect(calculateDeposit(333333, 20, 1000)).toBe(66667);
  });

  // The deposit is a prepayment deducted from the in-salon total, so the price is a hard
  // ceiling -- the configured minimum must never push it above what the booking costs.
  // (This case used to be pinned at 200000, i.e. charging 200,000 toman for a free
  // booking; the assertion was wrong, not merely weak, and is corrected here.)
  it('never exceeds the price: a zero-price booking has nothing to collect', () => {
    expect(calculateDeposit(0, 20, 200000)).toBe(0);
  });

  it('caps at the price when the minimum is higher than the price itself', () => {
    // Live config (20% / 200,000) against a cheap service: 200,000 > 150,000, so the
    // deposit is the whole price rather than a 133% overcharge.
    expect(calculateDeposit(150000, 20, 200000)).toBe(150000);
  });

  it('caps at the price when the percentage alone would exceed it', () => {
    // Defensive: a misconfigured deposit_percent above 100 still cannot overcharge.
    expect(calculateDeposit(100000, 150, 0)).toBe(100000);
  });

  it('never returns a negative deposit', () => {
    // Not reachable through resolveBestPrice (it clamps at 0) -- guards against a future
    // caller passing a negative price rather than silently charging a negative amount.
    expect(calculateDeposit(-5000, 20, 200000)).toBe(0);
  });

  it('leaves the exactly-at-the-minimum price untouched', () => {
    expect(calculateDeposit(200000, 20, 200000)).toBe(200000);
  });
});
