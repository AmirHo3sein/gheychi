import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { isUniqueViolation } from '../common/postgres-error-codes';
import { httpExceptionReasonCode } from '../metrics/http-exception-reason.util';
import { MetricsService } from '../metrics/metrics.service';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import {
  COUPON_ALREADY_REDEEMED,
  COUPON_EXPIRED,
  COUPON_FEATURE_DISABLED,
  COUPON_INVALID,
  COUPON_LIMIT_REACHED,
} from './coupon-error-codes';
import { CouponRedemption } from './coupon-redemption.entity';
import { Coupon } from './coupon.entity';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

export type CouponWithRedeemedCount = Coupon & { redeemedCount: number };

@Injectable()
export class CouponsService {
  constructor(
    @InjectRepository(Coupon) private readonly coupons: Repository<Coupon>,
    @InjectRepository(CouponRedemption) private readonly redemptions: Repository<CouponRedemption>,
    // Appended at the end, same convention as ReferralsService's own constructor
    // comment -- every existing positional `new CouponsService(...)` call site only
    // needs an arg added at the tail.
    private readonly metrics: MetricsService,
    private readonly platformConfig: PlatformConfigService,
  ) {}

  // Codes are normalized uppercase+trim on every write AND every lookup -- the
  // migration's unique index on `code` is plain varchar equality, so this
  // normalization is what actually makes the platform-wide namespace
  // case-insensitive in practice.
  private normalize(code: string): string {
    return code.trim().toUpperCase();
  }

  // Returns the same CouponWithRedeemedCount shape the list endpoints do, so a caller can
  // append the created row straight into a list it already holds. A brand-new coupon has
  // exactly zero redemptions by construction -- omitting the field left every consumer
  // rendering `undefined`, indistinguishable from missing data, until the next reload.
  private async create(data: {
    code: string;
    salonId: string | null;
    discountPercent: number;
    expiresAt?: string;
    maxRedemptions?: number;
  }): Promise<CouponWithRedeemedCount> {
    try {
      const coupon = await this.coupons.save(
        this.coupons.create({
          code: this.normalize(data.code),
          salonId: data.salonId,
          discountPercent: data.discountPercent,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
          maxRedemptions: data.maxRedemptions ?? null,
        }),
      );
      return { ...coupon, redeemedCount: 0 };
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('این کد قبلا استفاده شده است');
      throw err;
    }
  }

  createForSalon(salonId: string, dto: CreateCouponDto): Promise<CouponWithRedeemedCount> {
    return this.create({ ...dto, salonId });
  }

  createPlatformWide(dto: CreateCouponDto): Promise<CouponWithRedeemedCount> {
    return this.create({ ...dto, salonId: null });
  }

  // Shared by listForSalon/listPlatformWide -- a single queryBuilder query per call,
  // left-joining coupon_redemptions and grouping to attach each coupon's redeemedCount
  // rather than issuing a follow-up count query per row.
  private async listWithCounts(where: string, params: Record<string, unknown>): Promise<CouponWithRedeemedCount[]> {
    const rows = await this.coupons
      .createQueryBuilder('coupon')
      .leftJoin(CouponRedemption, 'redemption', 'redemption.couponId = coupon.id')
      .select('coupon.id', 'id')
      .addSelect('coupon.code', 'code')
      .addSelect('coupon.salonId', 'salonId')
      .addSelect('coupon.discountPercent', 'discountPercent')
      .addSelect('coupon.discountFixedAmount', 'discountFixedAmount')
      .addSelect('coupon.expiresAt', 'expiresAt')
      .addSelect('coupon.maxRedemptions', 'maxRedemptions')
      .addSelect('coupon.isActive', 'isActive')
      .addSelect('coupon.issuedToUserId', 'issuedToUserId')
      .addSelect('coupon.createdAt', 'createdAt')
      .addSelect('COUNT(redemption.id)', 'redeemedCount')
      .where(where, params)
      .groupBy('coupon.id')
      .orderBy('coupon.createdAt', 'DESC')
      .getRawMany<{
        id: string;
        code: string;
        salonId: string | null;
        discountPercent: number | null;
        discountFixedAmount: string | null;
        expiresAt: Date | null;
        maxRedemptions: number | null;
        isActive: boolean;
        issuedToUserId: string | null;
        createdAt: Date;
        redeemedCount: string;
      }>();
    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      salonId: r.salonId,
      discountPercent: r.discountPercent,
      // getRawMany bypasses the entity's nullableBigintToNumber transformer -- coerce
      // the bigint's raw string form (or null) here, same idiom as every other
      // getRawMany bigint/numeric field in this codebase.
      discountFixedAmount: r.discountFixedAmount === null ? null : Number(r.discountFixedAmount),
      expiresAt: r.expiresAt,
      maxRedemptions: r.maxRedemptions,
      isActive: r.isActive,
      issuedToUserId: r.issuedToUserId,
      createdAt: r.createdAt,
      redeemedCount: Number(r.redeemedCount),
    }));
  }

  // Referral-issued coupons (coupons.issued_to_user_id IS NOT NULL) are system-
  // generated, single-recipient rewards the platform already promised to a specific
  // user -- they deliberately do NOT appear in either manual coupon-management list,
  // even when their salon_id happens to match the caller's own salon (a salon_owner/
  // worker-type referral coupon carries the referring salon's id). Editing or
  // deactivating one through this generic UI would silently break a promise the
  // platform already made; they remain fully visible and manageable through the
  // Referrals admin screens instead (GET /admin/referrals/:id/rewards, Slice 5),
  // which is the correct, purpose-built place for them.
  listForSalon(salonId: string): Promise<CouponWithRedeemedCount[]> {
    return this.listWithCounts('coupon.salonId = :salonId AND coupon.issuedToUserId IS NULL', { salonId });
  }

  listPlatformWide(): Promise<CouponWithRedeemedCount[]> {
    return this.listWithCounts('coupon.salonId IS NULL AND coupon.issuedToUserId IS NULL', {});
  }

  // salonId: string -> only that salon's own coupon (provider caller); null -> only
  // platform-wide coupons (admin caller). Either way, 404 if the id doesn't exist in
  // that scope -- a provider can never touch another salon's coupon or a platform-wide
  // one, and an admin here only ever touches platform-wide coupons.
  async updateScoped(id: string, salonId: string | null, dto: UpdateCouponDto): Promise<Coupon> {
    const where = salonId === null ? { id, salonId: IsNull() } : { id, salonId };
    const patch: Partial<Coupon> = {};
    if (dto.code !== undefined) patch.code = this.normalize(dto.code);
    if (dto.discountPercent !== undefined) patch.discountPercent = dto.discountPercent;
    if (dto.expiresAt !== undefined) patch.expiresAt = dto.expiresAt === null ? null : new Date(dto.expiresAt);
    if (dto.maxRedemptions !== undefined) patch.maxRedemptions = dto.maxRedemptions;
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;

    let result;
    try {
      result = await this.coupons.update(where, patch);
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('این کد قبلا استفاده شده است');
      throw err;
    }
    if (!result.affected) throw new NotFoundException('Coupon not found');
    return (await this.coupons.findOneBy(where))!;
  }

  async deactivateScoped(id: string, salonId: string | null): Promise<void> {
    const where = salonId === null ? { id, salonId: IsNull() } : { id, salonId };
    const result = await this.coupons.update(where, { isActive: false });
    if (!result.affected) throw new NotFoundException('Coupon not found');
  }

  /**
   * The core validation used both by the read-only preview endpoint (em omitted) and
   * the real booking-creation flow (em passed in, running inside the same transaction
   * as the booking insert). Throws BadRequestException with a user-facing Persian
   * message for every invalid state; never distinguishes "doesn't exist" from "exists
   * but scoped to a different salon" in the message, to avoid leaking which codes
   * exist for other salons.
   */
  // Public entry point: instruments coupon_validation_attempts_total/
  // coupon_redemptions_total/coupon_rejections_total{reason} around
  // resolveAndValidateImpl's real logic -- kept as a thin wrapper rather than metrics
  // calls scattered across resolveAndValidateImpl's own several throw sites, so this
  // can never fall out of sync with a future validation rule added there. "redemption"
  // here means resolveAndValidateImpl accepted the code (returned rather than threw) --
  // both the read-only preview call (coupon-validation.controller.ts) and the real,
  // em-bound booking-time call reach it, since this is the one choke point named for
  // this metric; see coupon_redemptions_total's own `help` text.
  async resolveAndValidate(code: string, salonId: string, userId: string, em?: EntityManager): Promise<Coupon> {
    this.metrics.incCouponValidationAttempt();
    try {
      const coupon = await this.resolveAndValidateImpl(code, salonId, userId, em);
      this.metrics.incCouponRedemption();
      return coupon;
    } catch (err) {
      this.metrics.incCouponRejection(httpExceptionReasonCode(err));
      throw err;
    }
  }

  private async resolveAndValidateImpl(code: string, salonId: string, userId: string, em?: EntityManager): Promise<Coupon> {
    // Single choke point for BOTH the standalone preview and the real booking-time
    // redemption (see this method's own doc comment above) -- one guard covers both.
    const { couponsEnabled } = await this.platformConfig.getFeatureFlags();
    if (!couponsEnabled) {
      throw new BadRequestException({ message: 'کدهای تخفیف موقتاً غیرفعال است', code: COUPON_FEATURE_DISABLED });
    }

    const normalized = this.normalize(code);
    const couponRepo = em ? em.getRepository(Coupon) : this.coupons;
    const redemptionRepo = em ? em.getRepository(CouponRedemption) : this.redemptions;

    const coupon = await couponRepo.findOneBy({ code: normalized });
    if (!coupon || !coupon.isActive || (coupon.salonId !== null && coupon.salonId !== salonId)) {
      throw new BadRequestException({ message: 'کد تخفیف نامعتبر است', code: COUPON_INVALID });
    }
    // Referral-issued coupons (coupons.issued_to_user_id, Slice 5) are restricted to
    // their intended recipient -- same generic message (and code) as "doesn't exist" so
    // a caller can never learn a code exists but belongs to someone else. NULL (every
    // non-referral coupon, unchanged behavior) is unrestricted.
    if (coupon.issuedToUserId !== null && coupon.issuedToUserId !== userId) {
      throw new BadRequestException({ message: 'کد تخفیف نامعتبر است', code: COUPON_INVALID });
    }
    if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException({ message: 'کد تخفیف منقضی شده است', code: COUPON_EXPIRED });
    }

    const alreadyUsed = await redemptionRepo.findOneBy({ couponId: coupon.id, userId });
    if (alreadyUsed) {
      throw new BadRequestException({ message: 'شما قبلا از این کد تخفیف استفاده کرده‌اید', code: COUPON_ALREADY_REDEEMED });
    }

    if (coupon.maxRedemptions !== null) {
      if (em) {
        // Row-lock the coupon row itself to serialize concurrent redemption attempts
        // against the cap. This matters specifically for PLATFORM-WIDE coupons
        // (salonId null): those can be redeemed concurrently from entirely unrelated
        // salons' bookings, which are NOT covered by BookingsService.createHold's
        // Redis lock (keyed per salon, not per coupon) or by any other serialization
        // point. Without this lock, two concurrent bookings against two different
        // salons using the same capped platform-wide coupon could both read
        // count < maxRedemptions before either commits and both succeed, exceeding
        // the cap. Only taken on the real (em-bound) path -- a preview call has
        // nothing to serialize against since it never inserts a redemption row.
        await couponRepo
          .createQueryBuilder('coupon')
          .setLock('pessimistic_write')
          .where('coupon.id = :id', { id: coupon.id })
          .getOne();
      }
      const count = await redemptionRepo.count({ where: { couponId: coupon.id } });
      if (count >= coupon.maxRedemptions) {
        throw new BadRequestException({
          message: 'ظرفیت استفاده از این کد تخفیف تکمیل شده است',
          code: COUPON_LIMIT_REACHED,
        });
      }
    }

    return coupon;
  }
}
