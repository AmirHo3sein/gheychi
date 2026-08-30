import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateBillingPeriodDto } from './dto/billing-period.dto';
import { SubscriptionBillingPeriod, BillingPeriodStatus } from './subscription-billing-period.entity';
import { SubscriptionCouponRedemption } from './subscription-coupon-redemption.entity';
import { SubscriptionCoupon } from './subscription-coupon.entity';

/**
 * Architecture-only billing: an admin manually records a billing period for a salon's
 * subscription and later marks it paid/comp'd -- there is no cron generating these and no
 * real Zarinpal charge anywhere in this flow (the owner's own locked-in decision). See
 * docs/technical-overview/34-subscription-coupons-and-billing.md.
 */
@Injectable()
export class SubscriptionBillingService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(SubscriptionBillingPeriod) private readonly periods: Repository<SubscriptionBillingPeriod>,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  private normalizeCode(code: string): string {
    return code.trim().toUpperCase();
  }

  async createPeriod(salonId: string, dto: CreateBillingPeriodDto): Promise<SubscriptionBillingPeriod> {
    const periodStart = new Date(dto.periodStart);
    const periodEnd = new Date(dto.periodEnd);
    if (periodEnd.getTime() <= periodStart.getTime()) {
      throw new BadRequestException('پایان دوره باید بعد از شروع دوره باشد');
    }

    // The subscription's CURRENT plan, at the moment of billing -- frozen onto the period
    // row from here on (baseAmountToman), same "snapshot at creation, never re-derived"
    // convention as financial_transactions.commission_percent.
    const { plan } = await this.subscriptions.getForSalon(salonId);
    const baseAmountToman = plan.monthlyPriceToman;

    return this.dataSource.transaction(async (em) => {
      let discountPercent: number | null = null;
      let couponId: string | null = null;

      if (dto.couponCode) {
        const couponRepo = em.getRepository(SubscriptionCoupon);
        const redemptionRepo = em.getRepository(SubscriptionCouponRedemption);
        const normalized = this.normalizeCode(dto.couponCode);

        const coupon = await couponRepo.findOneBy({ code: normalized });
        if (!coupon || !coupon.isActive) {
          throw new BadRequestException('کد تخفیف اشتراک نامعتبر است');
        }
        if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
          throw new BadRequestException('کد تخفیف اشتراک منقضی شده است');
        }
        const alreadyUsed = await redemptionRepo.findOneBy({ couponId: coupon.id, salonId });
        if (alreadyUsed) {
          throw new BadRequestException('این سالن قبلا از این کد تخفیف استفاده کرده است');
        }
        if (coupon.maxRedemptions !== null) {
          // Row-lock the coupon itself to serialize concurrent redemptions against the cap --
          // same reasoning as CouponsService.resolveAndValidateImpl's own platform-wide-coupon
          // lock: this coupon can be redeemed concurrently by entirely unrelated salons, which
          // no per-salon lock elsewhere in this codebase would serialize.
          await couponRepo.createQueryBuilder('c').setLock('pessimistic_write').where('c.id = :id', { id: coupon.id }).getOne();
          const count = await redemptionRepo.count({ where: { couponId: coupon.id } });
          if (count >= coupon.maxRedemptions) {
            throw new BadRequestException('ظرفیت استفاده از این کد تخفیف تکمیل شده است');
          }
        }

        discountPercent = coupon.discountPercent;
        couponId = coupon.id;
      }

      const amountToman = couponId === null ? baseAmountToman : Math.round(baseAmountToman * (1 - discountPercent! / 100));

      const period = await em.getRepository(SubscriptionBillingPeriod).save(
        em.getRepository(SubscriptionBillingPeriod).create({
          salonId,
          planId: plan.id,
          periodStart,
          periodEnd,
          baseAmountToman,
          discountPercent,
          amountToman,
          couponId,
          status: 'pending',
        }),
      );

      if (couponId !== null) {
        await em.getRepository(SubscriptionCouponRedemption).save(
          em.getRepository(SubscriptionCouponRedemption).create({ couponId, salonId, billingPeriodId: period.id }),
        );
      }

      return period;
    });
  }

  listForSalon(salonId: string): Promise<SubscriptionBillingPeriod[]> {
    return this.periods.find({ where: { salonId }, order: { periodStart: 'DESC' } });
  }

  // Only from 'pending' -- a period that's already paid/comp'd/void is a settled financial
  // record, not something to silently overwrite by re-marking it. An admin who made a real
  // mistake corrects it by creating a fresh period, the same way a wrong invoice isn't
  // edited in place elsewhere in this codebase (see 13-financial-system.md).
  async setStatus(id: string, status: BillingPeriodStatus): Promise<SubscriptionBillingPeriod> {
    const period = await this.periods.findOneBy({ id });
    if (!period) throw new NotFoundException('Billing period not found');
    if (period.status !== 'pending') {
      throw new ConflictException('این دوره صورتحساب قبلا نهایی شده است');
    }
    await this.periods.update({ id }, { status, resolvedAt: new Date() });
    return (await this.periods.findOneBy({ id }))!;
  }
}
