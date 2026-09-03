import { ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Plan } from './plan.entity';
import { SalonSubscription } from './salon-subscription.entity';

export interface ResolvedSubscription {
  subscription: SalonSubscription;
  // The plan the subscription row itself references, regardless of active/canceled -- "what
  // the salon is nominally on." Distinct from resolvedEntitlements, which is "what's
  // actually in effect right now" (the two differ exactly when status is canceled).
  plan: Plan;
  resolvedEntitlements: Record<string, unknown>;
}

@Injectable()
export class SubscriptionsService {
  constructor(
    @InjectRepository(SalonSubscription) private readonly repo: Repository<SalonSubscription>,
    @InjectRepository(Plan) private readonly plans: Repository<Plan>,
  ) {}

  async getDefaultPlan(): Promise<Plan> {
    const plan = await this.plans.findOneBy({ isDefault: true });
    // Should be unreachable -- the migration seeds exactly one default plan and
    // PlansService.remove()/update() both refuse to leave zero. Defense-in-depth for a row
    // deleted/edited directly against the database afterwards, same posture as
    // PlatformConfigService's own getters.
    if (!plan) throw new InternalServerErrorException('No default plan configured');
    return plan;
  }

  /**
   * Inserts the initial subscription row for a newly created salon, pointed at whatever
   * plan is currently default. Called from SalonsService.createForOwner INSIDE that
   * method's own transaction (em passed through) so a salon can never exist even
   * momentarily without a resolvable subscription -- see the monetization spec's migration-
   * safety requirement (#23).
   */
  async createDefaultSubscription(salonId: string, em: EntityManager): Promise<void> {
    const defaultPlan = await em.findOneBy(Plan, { isDefault: true });
    if (!defaultPlan) throw new InternalServerErrorException('No default plan configured');
    await em.insert(SalonSubscription, {
      salonId,
      planId: defaultPlan.id,
      status: 'active',
      startedAt: new Date(),
    });
  }

  /**
   * The one entitlement-resolution seam every later phase (CRM/SMS quota, custom-handle
   * access, ...) is meant to read from. Three-way precedence, matching the owner's own
   * GLOBAL flag / PLAN entitlement / SALON-SPECIFIC override split: an active
   * subscription's plan entitlements, with any admin-set per-salon override merged in
   * key-by-key on top; falls back to the platform's current default plan (no overrides
   * applied -- those belonged to the now-ended arrangement) when the subscription is
   * canceled or missing, so a salon is never left with no resolvable entitlements at all.
   * Not wired into any enforcement yet -- that's each later phase's own job as it
   * introduces the specific keys it needs.
   */
  async getEntitlements(salonId: string): Promise<Record<string, unknown>> {
    const subscription = await this.repo.findOneBy({ salonId });
    if (subscription && subscription.status === 'active') {
      const plan = await this.plans.findOneBy({ id: subscription.planId });
      if (plan) return { ...plan.entitlements, ...(subscription.entitlementOverrides ?? {}) };
    }
    const defaultPlan = await this.getDefaultPlan();
    return defaultPlan.entitlements;
  }

  async getForSalon(salonId: string): Promise<ResolvedSubscription> {
    const subscription = await this.repo.findOneBy({ salonId });
    if (!subscription) throw new NotFoundException('No subscription for this salon');
    const plan = await this.plans.findOneBy({ id: subscription.planId });
    if (!plan) throw new InternalServerErrorException(`Subscription ${subscription.id} references a missing plan`);
    const resolvedEntitlements = await this.getEntitlements(salonId);
    return { subscription, plan, resolvedEntitlements };
  }

  async assignPlan(salonId: string, planId: string): Promise<ResolvedSubscription> {
    const plan = await this.plans.findOneBy({ id: planId });
    if (!plan) throw new NotFoundException('Plan not found');
    if (!plan.isActive) throw new ConflictException('این پلن غیرفعال است و قابل تخصیص نیست');
    const existing = await this.repo.findOneBy({ salonId });
    if (!existing) throw new NotFoundException('No subscription for this salon');

    await this.repo.update({ salonId }, { planId, status: 'active', canceledAt: null });
    return this.getForSalon(salonId);
  }

  async cancel(salonId: string): Promise<ResolvedSubscription> {
    const existing = await this.repo.findOneBy({ salonId });
    if (!existing) throw new NotFoundException('No subscription for this salon');
    if (existing.status === 'canceled') throw new ConflictException('این اشتراک از قبل لغو شده است');

    // Overrides belonged to the arrangement being ended (getEntitlements already ignores
    // them while canceled); clearing them here means a later assignPlan() starts from the
    // new plan verbatim instead of silently resurrecting last year's per-salon exceptions.
    await this.repo.update({ salonId }, { status: 'canceled', canceledAt: new Date(), entitlementOverrides: null });
    return this.getForSalon(salonId);
  }

  /**
   * The SALON-SPECIFIC override half of the three-way entitlement split -- admin-only
   * (never provider-editable, matching the owner's "salon owner picks only booking mode,
   * nothing commercial" decision). `overrides: null` clears every override back to
   * inheriting the plan verbatim; an object replaces the whole bag (not a per-key patch).
   */
  async setOverrides(salonId: string, overrides: Record<string, unknown> | null): Promise<ResolvedSubscription> {
    const existing = await this.repo.findOneBy({ salonId });
    if (!existing) throw new NotFoundException('No subscription for this salon');

    // Same TypeORM QueryDeepPartialEntity/jsonb escape hatch as PlansService.update's own
    // entitlements write.
    await this.repo.update({ salonId }, { entitlementOverrides: overrides as any });
    return this.getForSalon(salonId);
  }
}
