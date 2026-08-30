import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { SubscriptionCoupon } from './subscription-coupon.entity';
import { CreateSubscriptionCouponDto, UpdateSubscriptionCouponDto } from './dto/subscription-coupon.dto';

// Platform-wide-only, percent-only CRUD -- a deliberately smaller cousin of
// CouponsService (booking coupons): no salon-issued scope, no fixed-amount discount kind,
// no edit-confirm-diff UI on the frontend. See docs/technical-overview/34-subscription-coupons-and-billing.md.
@Injectable()
export class SubscriptionCouponsService {
  constructor(@InjectRepository(SubscriptionCoupon) private readonly coupons: Repository<SubscriptionCoupon>) {}

  private normalize(code: string): string {
    return code.trim().toUpperCase();
  }

  async create(dto: CreateSubscriptionCouponDto): Promise<SubscriptionCoupon> {
    try {
      return await this.coupons.save(
        this.coupons.create({
          code: this.normalize(dto.code),
          discountPercent: dto.discountPercent,
          expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
          maxRedemptions: dto.maxRedemptions ?? null,
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('این کد قبلا استفاده شده است');
      throw err;
    }
  }

  list(): Promise<SubscriptionCoupon[]> {
    return this.coupons.find({ order: { createdAt: 'DESC' } });
  }

  async update(id: string, dto: UpdateSubscriptionCouponDto): Promise<SubscriptionCoupon> {
    const patch: Partial<SubscriptionCoupon> = {};
    if (dto.discountPercent !== undefined) patch.discountPercent = dto.discountPercent;
    if (dto.expiresAt !== undefined) patch.expiresAt = dto.expiresAt === null ? null : new Date(dto.expiresAt);
    if (dto.maxRedemptions !== undefined) patch.maxRedemptions = dto.maxRedemptions;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;

    const result = await this.coupons.update({ id }, patch);
    if (!result.affected) throw new NotFoundException('Subscription coupon not found');
    return (await this.coupons.findOneBy({ id }))!;
  }

  async deactivate(id: string): Promise<void> {
    const result = await this.coupons.update({ id }, { isActive: false });
    if (!result.affected) throw new NotFoundException('Subscription coupon not found');
  }
}
