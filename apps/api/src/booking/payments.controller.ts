import { Controller, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { Public } from '../auth/public.decorator';
import { PAYMENT_FAILED } from './booking-error-codes';
import { PaymentsService } from './payments.service';

@Controller('payments')
@Public()
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly nestConfig: ConfigService,
  ) {}

  @Get('callback')
  async callback(@Query('Authority') authority: string, @Query('Status') status: string, @Res() res: Response) {
    const { status: outcome, bookingId } = await this.payments.handleCallback(authority, status);
    const frontendBase = this.nestConfig.get('FRONTEND_BASE_URL', 'http://localhost:3003');
    // Three distinct redirect states, because two of them are claims about the customer's
    // money and must not be conflated:
    //   success   -- captured AND the booking is confirmed
    //   refunding -- captured, but onto a booking that had already died (expired/cancelled
    //                mid-payment), so the deposit is being refunded rather than kept. This
    //                used to redirect as 'failed', i.e. the customer was told no payment
    //                happened and no booking exists while their bank showed the deduction.
    //   failed    -- nothing was captured (declined at the bank, cancelled, or an authority
    //                we cannot attribute to any payment)
    const redirectStatus =
      outcome === 'refunding' ? 'refunding'
      : outcome === 'failed' || outcome === 'unknown-authority' ? 'failed'
      : 'success';
    // An authority we can't resolve to any payment used to throw NotFoundException from
    // the service, so the customer's browser -- arriving straight from the bank, quite
    // possibly after a real deduction -- landed on raw 404 JSON. It is now reported to
    // operators as money-critical (PaymentsService.reportUnknownAuthority) and the
    // customer gets the normal failure page instead; the booking-callback page already
    // renders without a bookingId, so it is simply omitted rather than sent as "null".
    const query = new URLSearchParams({ status: redirectStatus });
    // Only the genuine-decline outcome gets a code: 'unknown-authority' also redirects
    // as status=failed for the customer, but it's a distinct failure (an authority this
    // platform cannot attribute to any payment at all), not a resolved decline -- see
    // booking-error-codes.ts's own doc comment.
    if (outcome === 'failed') query.set('code', PAYMENT_FAILED);
    if (bookingId) query.set('bookingId', bookingId);
    res.redirect(302, `${frontendBase}/booking/callback?${query.toString()}`);
  }
}
