import { BadRequestException } from '@nestjs/common';
import {
  reconcilePricingOnUpdate,
  validateDiscountForPricingType,
  validateDurationRange,
  validatePackageDurationShape,
  validatePricingShape,
} from './service-pricing.util';

describe('validatePricingShape', () => {
  it('accepts fixed with a price and no ceiling', () => {
    expect(() => validatePricingShape({ pricingType: 'fixed', price: 500000, priceMax: null })).not.toThrow();
  });

  it('accepts from with a floor and no ceiling', () => {
    expect(() => validatePricingShape({ pricingType: 'from', price: 1000000, priceMax: null })).not.toThrow();
  });

  it('accepts range with both bounds, max >= min', () => {
    expect(() => validatePricingShape({ pricingType: 'range', price: 2000000, priceMax: 5000000 })).not.toThrow();
  });

  it('accepts range with equal bounds', () => {
    expect(() => validatePricingShape({ pricingType: 'range', price: 2000000, priceMax: 2000000 })).not.toThrow();
  });

  it('accepts quote with no price at all', () => {
    expect(() => validatePricingShape({ pricingType: 'quote', price: null, priceMax: null })).not.toThrow();
  });

  it('rejects fixed with no price', () => {
    expect(() => validatePricingShape({ pricingType: 'fixed', price: null, priceMax: null })).toThrow(BadRequestException);
  });

  it('rejects from with no price', () => {
    expect(() => validatePricingShape({ pricingType: 'from', price: null, priceMax: null })).toThrow(BadRequestException);
  });

  it('rejects fixed with a stray priceMax', () => {
    expect(() => validatePricingShape({ pricingType: 'fixed', price: 500000, priceMax: 600000 })).toThrow(BadRequestException);
  });

  it('rejects range missing priceMax', () => {
    expect(() => validatePricingShape({ pricingType: 'range', price: 2000000, priceMax: null })).toThrow(BadRequestException);
  });

  it('rejects range missing price', () => {
    expect(() => validatePricingShape({ pricingType: 'range', price: null, priceMax: 5000000 })).toThrow(BadRequestException);
  });

  it('rejects range where max < min', () => {
    expect(() => validatePricingShape({ pricingType: 'range', price: 5000000, priceMax: 2000000 })).toThrow(BadRequestException);
  });

  it('rejects quote with a stray price', () => {
    expect(() => validatePricingShape({ pricingType: 'quote', price: 100, priceMax: null })).toThrow(BadRequestException);
  });

  it('rejects quote with a stray priceMax', () => {
    expect(() => validatePricingShape({ pricingType: 'quote', price: null, priceMax: 100 })).toThrow(BadRequestException);
  });
});

describe('validateDiscountForPricingType', () => {
  it('allows a discount on fixed', () => {
    expect(() => validateDiscountForPricingType('fixed', 20)).not.toThrow();
  });

  it('allows no discount on any type', () => {
    for (const t of ['fixed', 'from', 'range', 'quote'] as const) {
      expect(() => validateDiscountForPricingType(t, null)).not.toThrow();
    }
  });

  it('rejects a discount on from/range/quote', () => {
    expect(() => validateDiscountForPricingType('from', 10)).toThrow(BadRequestException);
    expect(() => validateDiscountForPricingType('range', 10)).toThrow(BadRequestException);
    expect(() => validateDiscountForPricingType('quote', 10)).toThrow(BadRequestException);
  });
});

describe('validateDurationRange', () => {
  it('allows no durationMax', () => {
    expect(() => validateDurationRange(60, null)).not.toThrow();
  });

  it('allows durationMax >= durationMin', () => {
    expect(() => validateDurationRange(60, 90)).not.toThrow();
    expect(() => validateDurationRange(60, 60)).not.toThrow();
  });

  it('rejects durationMax < durationMin', () => {
    expect(() => validateDurationRange(90, 60)).toThrow(BadRequestException);
  });
});

describe('validatePackageDurationShape', () => {
  it('allows both null', () => {
    expect(() => validatePackageDurationShape(null, null)).not.toThrow();
  });

  it('allows durationMin alone', () => {
    expect(() => validatePackageDurationShape(120, null)).not.toThrow();
  });

  it('allows a valid range', () => {
    expect(() => validatePackageDurationShape(120, 240)).not.toThrow();
  });

  it('rejects durationMax without durationMin', () => {
    expect(() => validatePackageDurationShape(null, 240)).toThrow(BadRequestException);
  });

  it('rejects durationMax < durationMin', () => {
    expect(() => validatePackageDurationShape(240, 120)).toThrow(BadRequestException);
  });
});

describe('reconcilePricingOnUpdate', () => {
  const fixedCurrent = { pricingType: 'fixed' as const, price: 500000, priceMax: null, discountPercent: 20 };

  it('leaves everything unchanged when the patch has no pricing fields at all', () => {
    expect(reconcilePricingOnUpdate(fixedCurrent, {})).toEqual(fixedCurrent);
  });

  it('updates a bare price without touching pricingType/discount (todays existing behavior)', () => {
    expect(reconcilePricingOnUpdate(fixedCurrent, { price: 600000 })).toEqual({
      pricingType: 'fixed',
      price: 600000,
      priceMax: null,
      discountPercent: 20,
    });
  });

  it('updates a bare discount without touching price', () => {
    expect(reconcilePricingOnUpdate(fixedCurrent, { discountPercent: 30 })).toEqual({
      pricingType: 'fixed',
      price: 500000,
      priceMax: null,
      discountPercent: 30,
    });
  });

  it('clearing the discount explicitly with null is preserved', () => {
    expect(reconcilePricingOnUpdate(fixedCurrent, { discountPercent: null })).toEqual({
      pricingType: 'fixed',
      price: 500000,
      priceMax: null,
      discountPercent: null,
    });
  });

  it('re-stating the same pricingType does not clear price/discount', () => {
    expect(reconcilePricingOnUpdate(fixedCurrent, { pricingType: 'fixed' })).toEqual(fixedCurrent);
  });

  it('switching fixed -> quote clears price, priceMax, and discount even if not supplied', () => {
    expect(reconcilePricingOnUpdate(fixedCurrent, { pricingType: 'quote' })).toEqual({
      pricingType: 'quote',
      price: null,
      priceMax: null,
      discountPercent: null,
    });
  });

  it('switching fixed -> range without supplying priceMax leaves it null (caught later by validatePricingShape)', () => {
    expect(reconcilePricingOnUpdate(fixedCurrent, { pricingType: 'range', price: 2000000 })).toEqual({
      pricingType: 'range',
      price: 2000000,
      priceMax: null,
      discountPercent: null,
    });
  });

  it('switching fixed -> range with both bounds supplied together works', () => {
    expect(
      reconcilePricingOnUpdate(fixedCurrent, { pricingType: 'range', price: 2000000, priceMax: 5000000 }),
    ).toEqual({ pricingType: 'range', price: 2000000, priceMax: 5000000, discountPercent: null });
  });

  it('switching quote -> fixed with a fresh price and discount together works', () => {
    const quoteCurrent = { pricingType: 'quote' as const, price: null, priceMax: null, discountPercent: null };
    expect(
      reconcilePricingOnUpdate(quoteCurrent, { pricingType: 'fixed', price: 400000, discountPercent: 15 }),
    ).toEqual({ pricingType: 'fixed', price: 400000, priceMax: null, discountPercent: 15 });
  });

  it('a request trying to keep an old discount while switching away from fixed is NOT silently cleared -- it is passed through and left for validatePricingShape/the DB to reject', () => {
    // discountPercent is explicitly present in the patch, so reconcile respects it verbatim;
    // the contradiction (non-null discount + non-fixed type) is a validation concern, not
    // this function's job to guess intent about.
    expect(
      reconcilePricingOnUpdate(fixedCurrent, { pricingType: 'range', price: 1000000, priceMax: 2000000, discountPercent: 20 }),
    ).toEqual({ pricingType: 'range', price: 1000000, priceMax: 2000000, discountPercent: 20 });
  });
});
