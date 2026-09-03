import { ForbiddenException, Injectable } from '@nestjs/common';
import { ENTITLEMENT_DEFINITIONS, EntitlementKey } from './entitlement-keys';
import { SubscriptionsService } from './subscriptions.service';

/**
 * The one place a feature asks "is this salon allowed to do X, and how much of it?"
 *
 * `SubscriptionsService.getEntitlements` answers what the plan+override RESOLVE to; this
 * answers what that MEANS for a specific capability, applying the registry's per-key
 * default for an absent or malformed value. Before this, the single enforced key did that
 * coercion inline, so the second feature to be gated would have copy-pasted the shape and
 * the third would have quietly diverged from it.
 *
 * Deliberately NOT a quota-consumption service. Usage is derived per feature from that
 * feature's own append-only log (SMS counts rows in `salon_sms_messages` within the current
 * Jalali month), which keeps usage impossible to drift from reality and avoids a
 * general-purpose counter that would have to understand every feature's reset period.
 * `remainingQuota` takes the already-computed usage rather than fetching it.
 */
@Injectable()
export class EntitlementsService {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  /** Whether a boolean capability is granted. */
  async hasFeature(salonId: string, key: EntitlementKey & string): Promise<boolean> {
    const raw = await this.resolveRaw(salonId, key);
    if (typeof raw === 'boolean') return raw;
    return ENTITLEMENT_DEFINITIONS[key].defaultValue === true;
  }

  /** Throws a 403 carrying a Persian message when the capability is not granted. */
  async requireFeature(salonId: string, key: EntitlementKey & string, message: string): Promise<void> {
    if (!(await this.hasFeature(salonId, key))) throw new ForbiddenException(message);
  }

  /**
   * A numeric ceiling. `null` means unlimited -- callers must handle it explicitly rather
   * than treating it as 0, which is why the return type keeps the null instead of
   * collapsing it to Infinity.
   */
  async getLimit(salonId: string, key: EntitlementKey & string): Promise<number | null> {
    const raw = await this.resolveRaw(salonId, key);
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) return raw;
    const fallback = ENTITLEMENT_DEFINITIONS[key].defaultValue;
    return typeof fallback === 'number' ? fallback : null;
  }

  /**
   * A quota is a limit whose absent-default is 0 rather than unlimited (see the registry).
   * Returned as a plain number because a quota key never means "unlimited" -- if a plan
   * genuinely should be uncapped, that is a very large number, not a missing key.
   */
  async getQuota(salonId: string, key: EntitlementKey & string): Promise<number> {
    const limit = await this.getLimit(salonId, key);
    return limit ?? 0;
  }

  /** How much of a quota is left, given usage the calling feature already counted. */
  async remainingQuota(salonId: string, key: EntitlementKey & string, used: number): Promise<number> {
    const quota = await this.getQuota(salonId, key);
    return Math.max(0, quota - used);
  }

  private async resolveRaw(salonId: string, key: string): Promise<unknown> {
    const entitlements = await this.subscriptions.getEntitlements(salonId);
    return entitlements[key];
  }
}
