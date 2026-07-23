import { applyDiscount, resolveBestPrice, resolveBestPriceWithWinner, resolveDiscountPercent } from './discount.util';

describe('resolveDiscountPercent', () => {
  it('returns 0 when both are null', () => {
    expect(resolveDiscountPercent(null, null)).toBe(0);
  });

  it('returns the service discount when only the service has one', () => {
    expect(resolveDiscountPercent(15, null)).toBe(15);
  });

  it('returns the coupon discount when only the coupon has one', () => {
    expect(resolveDiscountPercent(null, 25)).toBe(25);
  });

  it('picks the service discount when it is larger than the coupon', () => {
    expect(resolveDiscountPercent(30, 10)).toBe(30);
  });

  it('picks the coupon discount when it is larger than the service', () => {
    expect(resolveDiscountPercent(10, 30)).toBe(30);
  });

  it('returns the shared value when both are equal (no stacking)', () => {
    expect(resolveDiscountPercent(20, 20)).toBe(20);
  });

  it('supports a full 100 percent discount from either side', () => {
    expect(resolveDiscountPercent(100, 40)).toBe(100);
    expect(resolveDiscountPercent(40, 100)).toBe(100);
  });
});

describe('applyDiscount', () => {
  it('returns the price unchanged for a 0 percent discount', () => {
    expect(applyDiscount(2000000, 0)).toBe(2000000);
  });

  it('returns the price unchanged for a negative discount (defensive)', () => {
    expect(applyDiscount(2000000, -5)).toBe(2000000);
  });

  it('applies a straightforward percentage', () => {
    expect(applyDiscount(2000000, 20)).toBe(1600000);
  });

  it('reduces to 0 for a 100 percent discount', () => {
    expect(applyDiscount(2000000, 100)).toBe(0);
  });

  it('rounds to the nearest whole toman', () => {
    // 333333 * 0.85 = 283333.05 -> rounds to 283333
    expect(applyDiscount(333333, 15)).toBe(283333);
  });

  it('rounds up when the fractional remainder is at or above .5', () => {
    // 100005 * 0.9 = 90004.5 -> rounds to 90005 (Math.round rounds half up)
    expect(applyDiscount(100005, 10)).toBe(90005);
  });
});

describe('resolveBestPrice (Slice 6)', () => {
  it('returns the price unchanged for an empty candidates array', () => {
    expect(resolveBestPrice(2000000, [])).toBe(2000000);
  });

  it('returns the price unchanged when every candidate is null', () => {
    expect(resolveBestPrice(2000000, [null, null])).toBe(2000000);
  });

  it('skips null candidates rather than treating them as a free/zero-cost discount', () => {
    // Only the 10% candidate is real; the null must not be picked as "100% off".
    expect(resolveBestPrice(2000000, [null, { kind: 'percent', value: 10 }])).toBe(1800000);
  });

  describe('percent-only candidates match resolveDiscountPercent+applyDiscount exactly', () => {
    it.each([
      [2000000, 0],
      [2000000, 20],
      [2000000, 100],
      [333333, 15],
      [100005, 10],
    ])('price=%d percent=%d', (price, percent) => {
      const viaOldFns = applyDiscount(price, resolveDiscountPercent(percent, null));
      const viaNewFn = resolveBestPrice(price, [{ kind: 'percent', value: percent }]);
      expect(viaNewFn).toBe(viaOldFns);
    });

    it('picks the larger of two percent candidates, exactly like resolveDiscountPercent', () => {
      const price = 1000000;
      const viaOldFns = applyDiscount(price, resolveDiscountPercent(30, 10));
      const viaNewFn = resolveBestPrice(price, [
        { kind: 'percent', value: 30 },
        { kind: 'percent', value: 10 },
      ]);
      expect(viaNewFn).toBe(viaOldFns);
      expect(viaNewFn).toBe(700000);
    });
  });

  describe('fixed-only candidates', () => {
    it('subtracts the flat amount from the price', () => {
      expect(resolveBestPrice(2000000, [{ kind: 'fixed', value: 300000 }])).toBe(1700000);
    });

    it('picks the smaller resulting price among two fixed candidates', () => {
      expect(
        resolveBestPrice(2000000, [
          { kind: 'fixed', value: 100000 },
          { kind: 'fixed', value: 300000 },
        ]),
      ).toBe(1700000);
    });

    it('clamps at 0 rather than going negative when the fixed amount exceeds the price', () => {
      expect(resolveBestPrice(200000, [{ kind: 'fixed', value: 500000 }])).toBe(0);
    });
  });

  describe('one percent + one fixed candidate -- lower resulting price wins', () => {
    it('percent wins when it produces a lower price', () => {
      // price 2,000,000: 30% -> 1,400,000 vs fixed 300,000 -> 1,700,000. Percent wins.
      const result = resolveBestPrice(2000000, [
        { kind: 'percent', value: 30 },
        { kind: 'fixed', value: 300000 },
      ]);
      expect(result).toBe(1400000);
    });

    it('fixed wins when it produces a lower price', () => {
      // price 2,000,000: 5% -> 1,900,000 vs fixed 500,000 -> 1,500,000. Fixed wins.
      const result = resolveBestPrice(2000000, [
        { kind: 'percent', value: 5 },
        { kind: 'fixed', value: 500000 },
      ]);
      expect(result).toBe(1500000);
    });

    it('candidate order does not affect the outcome', () => {
      const a = resolveBestPrice(2000000, [
        { kind: 'fixed', value: 500000 },
        { kind: 'percent', value: 5 },
      ]);
      const b = resolveBestPrice(2000000, [
        { kind: 'percent', value: 5 },
        { kind: 'fixed', value: 500000 },
      ]);
      expect(a).toBe(b);
      expect(a).toBe(1500000);
    });
  });
});

describe('resolveBestPriceWithWinner (Slice 6)', () => {
  it('reports a null winner and the unchanged price when nothing beats "no discount"', () => {
    expect(resolveBestPriceWithWinner(2000000, [])).toEqual({ finalPrice: 2000000, winner: null });
    expect(resolveBestPriceWithWinner(2000000, [null])).toEqual({ finalPrice: 2000000, winner: null });
  });

  it('reports the percent candidate as the winner when it produces the lower price', () => {
    const result = resolveBestPriceWithWinner(2000000, [
      { kind: 'percent', value: 30 },
      { kind: 'fixed', value: 300000 },
    ]);
    expect(result).toEqual({ finalPrice: 1400000, winner: { kind: 'percent', value: 30 } });
  });

  it('reports the fixed candidate as the winner when it produces the lower price', () => {
    const result = resolveBestPriceWithWinner(2000000, [
      { kind: 'percent', value: 5 },
      { kind: 'fixed', value: 500000 },
    ]);
    expect(result).toEqual({ finalPrice: 1500000, winner: { kind: 'fixed', value: 500000 } });
  });

  it('on a tie, the earlier candidate in the array wins (matches resolveBestPrice\'s strict "<" comparison)', () => {
    const first = { kind: 'percent' as const, value: 20 };
    const second = { kind: 'fixed' as const, value: 400000 }; // also produces 1,600,000
    const result = resolveBestPriceWithWinner(2000000, [first, second]);
    expect(result.finalPrice).toBe(1600000);
    expect(result.winner).toBe(first);
  });

  it('agrees with resolveBestPrice on finalPrice for the exact same inputs', () => {
    const candidates: Array<{ kind: 'percent' | 'fixed'; value: number } | null> = [
      { kind: 'percent', value: 12 },
      null,
      { kind: 'fixed', value: 180000 },
    ];
    expect(resolveBestPriceWithWinner(2000000, candidates).finalPrice).toBe(resolveBestPrice(2000000, candidates));
  });
});
