import { BadRequestException } from '@nestjs/common';

/**
 * FIXED/FROM keep today's single-price shape (FROM's `price` is a floor, not a final
 * amount). RANGE adds a ceiling (`priceMax`). QUOTE has no number at all yet -- "price upon
 * consultation." Mirrors `salon_services_pricing_type_chk`/`salon_services_pricing_shape_chk`
 * (migration 1756700000000) and the identical pair on `salon_packages`
 * (migration 1756900000000) exactly; both DB CHECKs are the authoritative backstop this
 * util's own validation exists to fail *before* ever reaching.
 */
export const PRICING_TYPES = ['fixed', 'from', 'range', 'quote'] as const;
export type PricingType = (typeof PRICING_TYPES)[number];

export interface PricingFields {
  pricingType: PricingType;
  price: number | null;
  priceMax: number | null;
}

/**
 * Throws a clear, Persian, `BadRequestException` for any (pricingType, price, priceMax)
 * combination the DB shape CHECK would also reject -- called before every create/update so
 * a malformed request never surfaces as a raw constraint-violation 400 with no useful
 * message. Deliberately does NOT touch discountPercent (see `validateDiscountForPricingType`
 * below) -- kept separate since discount is optional and orthogonal to the price shape itself.
 */
export function validatePricingShape(fields: PricingFields): void {
  const { pricingType, price, priceMax } = fields;
  if (pricingType === 'quote') {
    if (price !== null || priceMax !== null) {
      throw new BadRequestException('برای قیمت توافقی نباید مبلغی وارد شود');
    }
    return;
  }
  if (pricingType === 'fixed' || pricingType === 'from') {
    if (price === null) {
      throw new BadRequestException('وارد کردن قیمت الزامی است');
    }
    if (priceMax !== null) {
      throw new BadRequestException('این نوع قیمت‌گذاری سقف قیمت ندارد');
    }
    return;
  }
  // range
  if (price === null || priceMax === null) {
    throw new BadRequestException('برای بازه قیمتی، حداقل و حداکثر هر دو الزامی است');
  }
  if (priceMax < price) {
    throw new BadRequestException('حداکثر قیمت نمی‌تواند کمتر از حداقل قیمت باشد');
  }
}

/**
 * A per-service discount is a percentage OFF one known final price -- meaningless once that
 * price isn't fixed (FROM/RANGE) or doesn't exist yet (QUOTE). Mirrors
 * `salon_services_discount_fixed_only_chk`.
 */
export function validateDiscountForPricingType(pricingType: PricingType, discountPercent: number | null): void {
  if (discountPercent !== null && pricingType !== 'fixed') {
    throw new BadRequestException('تخفیف فقط برای خدمات با قیمت ثابت قابل تنظیم است');
  }
}

/**
 * `durationMax` is purely informational ("takes about 2-4 hours") -- the booking/
 * availability engine only ever reads `durationMin`. Mirrors
 * `salon_services_duration_max_chk`.
 */
export function validateDurationRange(durationMin: number, durationMax: number | null): void {
  if (durationMax !== null && durationMax < durationMin) {
    throw new BadRequestException('حداکثر مدت زمان نمی‌تواند کمتر از حداقل باشد');
  }
}

/**
 * Package duration is entirely optional and advisory (never read by the booking engine --
 * each item's own service.durationMin governs that item's own booking), so unlike
 * `validateDurationRange` above, `durationMin` itself may be null here. Mirrors
 * `salon_packages_duration_shape_chk`.
 */
export function validatePackageDurationShape(durationMin: number | null, durationMax: number | null): void {
  if (durationMax === null) return;
  if (durationMin === null) {
    throw new BadRequestException('برای تعیین حداکثر مدت زمان، حداقل نیز باید مشخص شود');
  }
  if (durationMax < durationMin) {
    throw new BadRequestException('حداکثر مدت زمان نمی‌تواند کمتر از حداقل باشد');
  }
}

/**
 * Reconciles a PATCH against a service's/package's CURRENT persisted pricing fields.
 *
 * A price-type change is treated as an atomic, fully-specified operation: switching
 * `pricingType` clears whatever price fields the request doesn't ALSO supply in that same
 * request (never leaves a stale `price`/`priceMax` from the old type lying around to trip
 * the shape CHECK) -- so switching to RANGE without supplying both bounds, or to QUOTE while
 * still sending a price, correctly fails `validatePricingShape` on the reconciled result
 * rather than silently keeping half of the old shape. A bare price/discount edit with no
 * `pricingType` in the request (today's only case) is completely unaffected -- only fields
 * actually present in `patch` change, exactly like the plain `Object.assign` this replaces.
 */
export function reconcilePricingOnUpdate(
  current: { pricingType: PricingType; price: number | null; priceMax: number | null; discountPercent: number | null },
  patch: { pricingType?: PricingType; price?: number | null; priceMax?: number | null; discountPercent?: number | null },
): { pricingType: PricingType; price: number | null; priceMax: number | null; discountPercent: number | null } {
  const pricingType = patch.pricingType ?? current.pricingType;
  const typeChanged = patch.pricingType !== undefined && patch.pricingType !== current.pricingType;

  const price = patch.price !== undefined ? patch.price : typeChanged ? null : current.price;
  const priceMax = patch.priceMax !== undefined ? patch.priceMax : typeChanged ? null : current.priceMax;
  const discountPercent =
    patch.discountPercent !== undefined
      ? patch.discountPercent
      : typeChanged && pricingType !== 'fixed'
        ? null
        : current.discountPercent;

  return { pricingType, price, priceMax, discountPercent };
}
