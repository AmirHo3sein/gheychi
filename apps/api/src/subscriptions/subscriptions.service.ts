import { ConflictException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Plan } from './plan.entity';
import { SalonSubscription } from './salon-subscription.entity';

export interface ResolvedSubscription {
  subscription: SalonSubscription;
  plan: Plan;
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

  async getForSalon(salonId: string): Promise<ResolvedSubscription> {
    const subscription = await this.repo.findOneBy({ salonId });
    if (!subscription) throw new NotFoundException('No subscription for this salon');
    const plan = await this.plans.findOneBy({ id: subscription.planId });
    if (!plan) throw new InternalServerErrorException(`Subscription ${subscription.id} references a missing plan`);
    return { subscription, plan };
  }

  /**
   * The one entitlement-resolution seam every later phase (CRM/SMS quota, custom-handle
   * access, ...) is meant to read from -- returns the salon's live plan entitlements,
   * falling back to the platform's current default plan if the salon's own subscription is
   * canceled (a salon must never be left with no resolvable entitlements at all). Not
   * wired into any enforcement yet -- that is deliberately the next phase's job (see the
   * monetization spec's phase order).
   */
  async getEntitlements(salonId: string): Promise<Record<string, unknown>> {
    const subscription = await this.repo.findOneBy({ salonId });
    if (subscription && subscription.status === 'active') {
      const plan = await this.plans.findOneBy({ id: subscription.planId });
      if (plan) return plan.entitlements;
    }
    const defaultPlan = await this.getDefaultPlan();
    return defaultPlan.entitlements;
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

    await this.repo.update({ salonId }, { status: 'canceled', canceledAt: new Date() });
    return this.getForSalon(salonId);
  }
}
