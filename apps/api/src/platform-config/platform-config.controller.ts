import { Controller, Get } from '@nestjs/common';
import { PlatformConfigService } from './platform-config.service';

@Controller('platform-config')
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
}
