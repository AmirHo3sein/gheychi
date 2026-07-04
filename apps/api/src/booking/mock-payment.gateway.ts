import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PaymentGateway, PaymentRequestResult, PaymentVerifyResult } from './payment-gateway';

@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  async requestPayment(_amountToman: number, _description: string, callbackUrl: string): Promise<PaymentRequestResult> {
    const authority = `MOCK-${randomBytes(8).toString('hex')}`;
    return { authority, paymentUrl: `${callbackUrl}?Authority=${authority}&Status=OK` };
  }

  async verifyPayment(authority: string, _amountToman: number): Promise<PaymentVerifyResult> {
    if (authority.startsWith('MOCK-FAIL')) return { success: false, refId: null };
    return { success: true, refId: `MOCKREF-${authority}` };
  }
}
