import { Body, Controller, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Request } from 'express';
import { Repository } from 'typeorm';
import { AuthGuard } from '../auth/auth.guard';
import { DiscountCandidate, resolveBestPriceWithWinner } from '../booking/discount.util';
import { calculateDeposit } from '../booking/deposit.util';
import { PlatformConfigService } from '../platform-config/platform-config.service';
import { SalonService } from '../salons/salon-service.entity';
import { Salon } from '../salons/salon.entity';
import { User } from '../users/user.entity';
import { CouponsService } from './coupons.service';
import { ValidateCouponDto } from './dto/coupon.dto';

@Controller('coupons')
@UseGuards(AuthGuard)
export class CouponValidationController {
  constructor(
    private readonly couponsService: CouponsService,
    private readonly config: PlatformConfigService,
    @InjectRepository(Salon) private readonly salons: Repository<Salon>,
    @InjectRepository(SalonService) private readonly services: Repository<SalonService>,
  ) {}

  // Read-only, non-consuming preview -- resolveAndValidate is called without an
  // EntityManager, so it never row-locks or otherwise interacts with the real
  // redemption path. The actual redemption only happens inside
  // BookingsService.createHold's transaction.
  @Post('validate')
  async validate(@Req() req: Request, @Body() dto: ValidateCouponDto) {
    const salon = await this.salons.findOneBy({ id: dto.salonId, status: 'approved' });
    if (!salon) throw new NotFoundException('Salon not found');

    const service = await this.services.findOneBy({ id: dto.serviceId, salonId: dto.salonId, isActive: true });
    if (!service) throw new NotFoundException('Service not found');

    const coupon = await this.couponsService.resolveAndValidate(dto.code, dto.salonId, (req.user as User).id);

    // Slice 6: the coupon can now be either percent- or fixed-toman-kind. Same
    // best-resulting-price comparison BookingsService.createHold uses for the real
    // booking, so this preview can never disagree with what actually gets charged.
    const serviceCandidate: DiscountCandidate =
      service.discountPercent !== null ? { kind: 'percent', value: service.discountPercent } : null;
    const couponCandidate: DiscountCandidate =
      coupon.discountPercent !== null
        ? { kind: 'percent', value: coupon.discountPercent }
        : { kind: 'fixed', value: coupon.discountFixedAmount! };
    const { finalPrice, winner } = resolveBestPriceWithWinner(service.price, [serviceCandidate, couponCandidate]);

    const depositPercent = await this.config.getDepositPercent();
    const depositMin = await this.config.getDepositMinToman();
    const estimatedDeposit = calculateDeposit(finalPrice, depositPercent, depositMin);

    return {
      valid: true,
      // Legacy field, kept for backward compatibility -- but ONLY populated when the
      // coupon itself is percent-kind. A fixed-toman coupon has no meaningful percent
      // to report here; a client must not be given a fabricated one.
      couponDiscountPercent: coupon.discountPercent,
      // New, discount-kind-aware fields (additive) -- always tell the truth about
      // what the COUPON itself is, independent of whether it actually wins against
      // the service's own discount.
      couponDiscountKind: coupon.discountPercent !== null ? 'percent' : 'fixed',
      couponDiscountValue: coupon.discountPercent !== null ? coupon.discountPercent : coupon.discountFixedAmount!,
      serviceDiscountPercent: service.discountPercent,
      // Legacy field, kept for backward compatibility -- populated ONLY when the
      // WINNING discount was percent-kind (whether that came from the service or the
      // coupon); left undefined when fixed-kind won or nothing won, so a client can
      // never mistake this for a fabricated percent equivalent of a fixed discount.
      appliedDiscountPercent: winner?.kind === 'percent' ? winner.value : undefined,
      // The authoritative numbers, safe for a client to use regardless of kind -- "you
      // saved X toman" is always originalPrice - finalPrice, no branching needed.
      originalPrice: service.price,
      finalPrice,
      estimatedDeposit,
    };
  }
}
