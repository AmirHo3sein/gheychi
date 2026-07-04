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

  it('returns the minimum for a zero-price service', () => {
    expect(calculateDeposit(0, 20, 200000)).toBe(200000);
  });
});
