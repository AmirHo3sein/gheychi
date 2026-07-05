import { Controller, Get, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('callback')
  async callback(@Query('Authority') authority: string, @Query('Status') status: string, @Res() res: Response) {
    const { status: outcome, bookingId } = await this.payments.handleCallback(authority, status);
    const frontendBase = process.env.FRONTEND_BASE_URL ?? 'http://localhost:3003';
    const redirectStatus = outcome === 'failed' ? 'failed' : 'success';
    res.redirect(302, `${frontendBase}/booking/callback?status=${redirectStatus}&bookingId=${bookingId}`);
  }
}
