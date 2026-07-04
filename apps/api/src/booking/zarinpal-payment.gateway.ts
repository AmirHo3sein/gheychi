import { Injectable } from '@nestjs/common';
import { PaymentGateway, PaymentRequestResult, PaymentVerifyResult } from './payment-gateway';

const REQUEST_URL = 'https://payment.zarinpal.com/pg/v4/payment/request.json';
const VERIFY_URL = 'https://payment.zarinpal.com/pg/v4/payment/verify.json';
const STARTPAY_URL = 'https://payment.zarinpal.com/pg/StartPay';
const TOMAN_TO_RIAL = 10;

interface ZarinpalRequestResponse {
  data: { code: number; authority: string; message: string } | null;
  errors: unknown;
}

interface ZarinpalVerifyResponse {
  data: { code: number; ref_id: number; message: string } | null;
  errors: unknown;
}

/**
 * Field names and status codes (merchant_id, callback_url, code 100/101,
 * the /pg/v4/payment/* endpoints, /pg/StartPay/{authority}) are Zarinpal's
 * documented v4 REST contract. VERIFY AGAINST ZARINPAL'S SANDBOX before
 * taking real payments -- see this plan's header note for why that couldn't
 * be done during planning. Every automated test uses MockPaymentGateway;
 * nothing in the test suite calls this class's real network path.
 */
@Injectable()
export class ZarinpalGateway implements PaymentGateway {
  constructor(private readonly merchantId: string) {}

  async requestPayment(amountToman: number, description: string, callbackUrl: string): Promise<PaymentRequestResult> {
    let res: Response;
    try {
      res = await fetch(REQUEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: this.merchantId,
          amount: amountToman * TOMAN_TO_RIAL,
          callback_url: callbackUrl,
          description,
        }),
      });
    } catch (err) {
      throw new Error(`Zarinpal request failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const body = (await res.json()) as ZarinpalRequestResponse;
    if (!res.ok || body.data?.code !== 100) {
      throw new Error(`Zarinpal request failed: ${JSON.stringify(body.errors ?? body.data)}`);
    }
    return {
      authority: body.data.authority,
      paymentUrl: `${STARTPAY_URL}/${body.data.authority}`,
    };
  }

  async verifyPayment(authority: string, amountToman: number): Promise<PaymentVerifyResult> {
    let res: Response;
    try {
      res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          merchant_id: this.merchantId,
          amount: amountToman * TOMAN_TO_RIAL,
          authority,
        }),
      });
    } catch (err) {
      throw new Error(`Zarinpal verify failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    const body = (await res.json()) as ZarinpalVerifyResponse;
    if (body.data?.code === 100 || body.data?.code === 101) {
      return { success: true, refId: String(body.data.ref_id) };
    }
    return { success: false, refId: null };
  }
}
