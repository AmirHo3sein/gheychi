import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PaymentGateway, PaymentRefundResult, PaymentRequestResult, PaymentVerifyResult } from './payment-gateway';

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

  async refundPayment(authority: string): Promise<PaymentRefundResult> {
    if (authority.includes('MOCK-REFUND-FAIL')) return { success: false, refundRefId: null };
    return { success: true, refundRefId: `MOCKREFUND-${authority}` };
  }
}
