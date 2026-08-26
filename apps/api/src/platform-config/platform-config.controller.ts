import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PlatformConfigService } from './platform-config.service';

@Controller('platform-config')
@Public()
export class PlatformConfigController {
  constructor(private readonly config: PlatformConfigService) {}

  @Get('booking-terms')
  async bookingTerms() {
    const [depositPercent, depositMinToman, cancellationWindowHours] = await Promise.all([
      this.config.getDepositPercent(),
      this.config.getDepositMinToman(),
      this.config.getCancellationWindowHours(),
    ]);
    return { depositPercent, depositMinToman, cancellationWindowHours };
  }

  @Get('feature-flags')
  getFeatureFlags() {
    return this.config.getFeatureFlags();
  }
}
