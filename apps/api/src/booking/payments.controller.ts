import { Controller, Get, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('callback')
  callback(@Query('Authority') authority: string, @Query('Status') status: string) {
    return this.payments.handleCallback(authority, status);
  }
}
