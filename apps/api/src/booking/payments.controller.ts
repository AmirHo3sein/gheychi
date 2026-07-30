import { Controller, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly nestConfig: ConfigService,
  ) {}

  @Get('callback')
  async callback(@Query('Authority') authority: string, @Query('Status') status: string, @Res() res: Response) {
    const { status: outcome, bookingId } = await this.payments.handleCallback(authority, status);
    const frontendBase = this.nestConfig.get('FRONTEND_BASE_URL', 'http://localhost:3003');
    const redirectStatus = outcome === 'failed' || outcome === 'unknown-authority' ? 'failed' : 'success';
    // An authority we can't resolve to any payment used to throw NotFoundException from
    // the service, so the customer's browser -- arriving straight from the bank, quite
    // possibly after a real deduction -- landed on raw 404 JSON. It is now reported to
    // operators as money-critical (PaymentsService.reportUnknownAuthority) and the
    // customer gets the normal failure page instead; the booking-callback page already
    // renders without a bookingId, so it is simply omitted rather than sent as "null".
    const query = new URLSearchParams({ status: redirectStatus });
    if (bookingId) query.set('bookingId', bookingId);
    res.redirect(302, `${frontendBase}/booking/callback?${query.toString()}`);
  }
}
