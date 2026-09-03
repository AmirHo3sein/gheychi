import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

/**
 * The registry of every entitlement key the platform understands.
 *
 * Why a registry rather than free-form keys: `plans.entitlements` is an open jsonb bag an
 * admin edits as raw JSON, so before this file the set of meaningful keys existed only in
 * the heads of whoever wired each feature. Exactly one key (`smsMonthlyQuota`) was ever
 * enforced, `crmCustomerCap` existed only in a test fixture, and a typo in the admin editor
 * produced a silently-ignored key with no feedback at all.
 *
 * Each key declares the ONE thing every call site must otherwise re-decide by hand: what it
 * means when the key is absent. That default is a real product decision per key, not a
 * convention that can be applied uniformly:
 *
 *  - a `quota` bounds a real per-unit platform cost, so absent means ZERO (blocked). A plan
 *    an admin has not configured yet must never hand out free SMS.
 *  - a `feature` is a capability gate, so absent means the capability is OFF unless the key
 *    says otherwise -- except where turning it off would take away something every salon
 *    already has today, which is why `customHandle`/`qrCode` default to TRUE (see below).
 *  - a `limit` is a defensive ceiling, so absent means UNLIMITED -- the referral system's
 *    own `maxReferralsPerReferrer: null` convention.
 *
 * Adding a key here does not enforce it; the consuming feature still calls
 * EntitlementsService. But a key NOT here is a typo, and the admin panel can say so.
 */
export type EntitlementKind = 'feature' | 'limit' | 'quota';

export interface EntitlementDefinition {
  kind: EntitlementKind;
  /** Applied when the resolved entitlement bag has no entry (or a malformed one) for this key. */
  defaultValue: boolean | number | null;
  /** Shown in the admin plan editor. Persian, because that is who reads it. */
  label: string;
}

export const ENTITLEMENT_DEFINITIONS = {
  /**
   * Monthly salon-initiated customer SMS. Absent => 0: every message costs the platform
   * real money, so an unconfigured plan grants none. Backfilled to 20 for every existing
   * plan when the feature shipped, rather than silently blocking live salons.
   */
  smsMonthlyQuota: { kind: 'quota', defaultValue: 0, label: 'سقف پیامک ماهانه' },

  /**
   * Editing the salon's public handle. Defaults TRUE, unlike a normal feature gate: every
   * salon can do this today, and shipping a registry that flipped it off would revoke a
   * live capability from every salon on the default plan the moment it deployed. An admin
   * makes it a paid feature by setting it false on the plans that should not have it.
   */
  customHandle: { kind: 'feature', defaultValue: true, label: 'ویرایش نشانی اختصاصی' },

  /** QR code for the public salon link. Defaults TRUE for the same reason as customHandle. */
  qrCode: { kind: 'feature', defaultValue: true, label: 'کد QR' },

  /**
   * Ceiling on the CRM customer list. Absent => null (unlimited), matching the referral
   * system's own cap convention -- a missing ceiling has never meant "show nothing".
   * Distinct from MAX_CUSTOMERS_LISTED, which is a defensive query bound, not a product cap.
   */
  crmCustomerCap: { kind: 'limit', defaultValue: null, label: 'سقف مشتریان CRM' },
} as const satisfies Record<string, EntitlementDefinition>;

export type EntitlementKey = keyof typeof ENTITLEMENT_DEFINITIONS;

export const ENTITLEMENT_KEYS = Object.keys(ENTITLEMENT_DEFINITIONS) as EntitlementKey[];

export function isKnownEntitlementKey(key: string): key is EntitlementKey {
  return Object.hasOwn(ENTITLEMENT_DEFINITIONS, key);
}

/**
 * class-validator constraint wiring the registry above into every DTO that accepts a raw
 * entitlements bag (`plans.entitlements`, `salon_subscriptions.entitlement_overrides`).
 * Both are admin-edited free-form jsonb, so without this a typo in the admin panel's JSON
 * editor (e.g. `smsMonthlyQouta`) previously saved silently -- the resolution engine falls
 * back to the registry's absent-default for the real key, which for `smsMonthlyQuota` is
 * 0 (blocked), silently disabling a paid capability with no admin-visible signal at all.
 * `@Validate(KnownEntitlementKeysConstraint)` rejects the write at the API boundary
 * instead, same house pattern as `PercentRewardValueCapConstraint` (referral.dto.ts).
 */
function unknownEntitlementKeysIn(value: unknown): string[] {
  if (value === null || value === undefined) return []; // @IsOptional/@ValidateIf's job
  if (typeof value !== 'object' || Array.isArray(value)) return []; // @IsObject's job
  return Object.keys(value).filter((key) => !isKnownEntitlementKey(key));
}

@ValidatorConstraint({ name: 'knownEntitlementKeys', async: false })
export class KnownEntitlementKeysConstraint implements ValidatorConstraintInterface {
  // Stateless (recomputes from ValidationArguments.value in both methods) rather than
  // caching onto `this` -- this constraint is instantiated once and shared across
  // concurrent requests by class-validator's own container.
  validate(value: unknown): boolean {
    return unknownEntitlementKeysIn(value).length === 0;
  }

  defaultMessage(args: ValidationArguments): string {
    const unknownKeys = unknownEntitlementKeysIn(args.value);
    return `کلید(های) نامعتبر در entitlements: ${unknownKeys.join(', ')} -- کلیدهای معتبر: ${ENTITLEMENT_KEYS.join(', ')}`;
  }
}
