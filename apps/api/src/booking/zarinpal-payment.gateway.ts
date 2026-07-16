import { Injectable, Logger } from '@nestjs/common';
import { PaymentGateway, PaymentRefundResult, PaymentRequestResult, PaymentVerifyResult } from './payment-gateway';

const REQUEST_URL = 'https://payment.zarinpal.com/pg/v4/payment/request.json';
const VERIFY_URL = 'https://payment.zarinpal.com/pg/v4/payment/verify.json';
const REFUND_URL = 'https://payment.zarinpal.com/pg/v4/payment/refund.json';
const STARTPAY_URL = 'https://payment.zarinpal.com/pg/StartPay';
const TOMAN_TO_RIAL = 10;
const ZARINPAL_TIMEOUT_MS = 10_000;

interface ZarinpalRequestResponse {
  data: { code: number; authority: string; message: string } | null;
  errors: unknown;
}

interface ZarinpalVerifyResponse {
  data: { code: number; ref_id: number; message: string } | null;
  errors: unknown;
}

interface ZarinpalRefundResponse {
  data: { code: number; message: string; ref_id?: number; session?: number; iban?: string } | null;
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
  private readonly logger = new Logger(ZarinpalGateway.name);

  constructor(
    private readonly merchantId: string,
    private readonly accessToken: string,
  ) {}

  async requestPayment(amountToman: number, description: string, callbackUrl: string): Promise<PaymentRequestResult> {
    let res: Response;
    let body: ZarinpalRequestResponse;
    try {
      res = await fetch(REQUEST_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(ZARINPAL_TIMEOUT_MS),
        body: JSON.stringify({
          merchant_id: this.merchantId,
          amount: amountToman * TOMAN_TO_RIAL,
          callback_url: callbackUrl,
          description,
        }),
      });
      // res.json() must stay inside this try -- a non-JSON body (e.g. an HTML
      // error page from a WAF/proxy under load) would otherwise throw a raw,
      // unwrapped SyntaxError instead of the intended "Zarinpal request failed" error.
      body = (await res.json()) as ZarinpalRequestResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Zarinpal request failed: ${message}`);
      throw new Error(`Zarinpal request failed: ${message}`);
    }
    if (!res.ok || body.data?.code !== 100) {
      this.logger.error(`Zarinpal request failed: HTTP ${res.status} ${JSON.stringify(body.errors ?? body.data)}`);
      throw new Error(`Zarinpal request failed: HTTP ${res.status} ${JSON.stringify(body.errors ?? body.data)}`);
    }
    return {
      authority: body.data.authority,
      paymentUrl: `${STARTPAY_URL}/${body.data.authority}`,
    };
  }

  async verifyPayment(authority: string, amountToman: number): Promise<PaymentVerifyResult> {
    let res: Response;
    let body: ZarinpalVerifyResponse;
    try {
      res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(ZARINPAL_TIMEOUT_MS),
        body: JSON.stringify({
          merchant_id: this.merchantId,
          amount: amountToman * TOMAN_TO_RIAL,
          authority,
        }),
      });
      body = (await res.json()) as ZarinpalVerifyResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Zarinpal verify failed for authority ${authority}: ${message}`);
      throw new Error(`Zarinpal verify failed: ${message}`);
    }
    // Unlike a genuine decline (a non-100/101 code with a normal HTTP response),
    // a non-ok HTTP status means Zarinpal's API itself failed (outage, rate limit,
    // maintenance) -- that must throw, not silently collapse into {success: false},
    // which would be indistinguishable from a real decline to the caller and could
    // tell a customer their payment failed when the real problem was infrastructure.
    if (!res.ok) {
      this.logger.error(`Zarinpal verify returned HTTP ${res.status} for authority ${authority}: ${JSON.stringify(body.errors ?? body.data)}`);
      throw new Error(`Zarinpal verify failed: HTTP ${res.status} ${JSON.stringify(body.errors ?? body.data)}`);
    }
    if (body.data?.code === 100 || body.data?.code === 101) {
      return { success: true, refId: String(body.data.ref_id) };
    }
    return { success: false, refId: null };
  }

  /**
   * Refunds the full captured amount of a transaction by its authority.
   * POST /pg/v4/payment/refund.json with a Bearer personal access token
   * (generated in the Zarinpal panel -- separate from the merchant id).
   * Codes 100/101 are treated as success, mirroring verifyPayment's contract,
   * on the assumption that a repeat refund attempt after a crash is harmless.
   * WARNING (2026-07-17 research): this endpoint matches Zarinpal's LEGACY
   * REST refund contract, de-documented ~2023; the current official refund
   * API is a GraphQL AddRefund mutation (different host, identifier, required
   * amount, no numeric code), and Zarinpal permits ONE refund request per
   * transaction -- so both the endpoint and the idempotency assumption are
   * unverified and probably wrong. No sandbox covers refunds; before taking
   * real refunds, execute docs/deployment/ZARINPAL-REFUND-VERIFICATION.md
   * against production and rework this method per its findings.
   */
  async refundPayment(authority: string): Promise<PaymentRefundResult> {
    let res: Response;
    let body: ZarinpalRefundResponse;
    try {
      res = await fetch(REFUND_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.accessToken}` },
        signal: AbortSignal.timeout(ZARINPAL_TIMEOUT_MS),
        body: JSON.stringify({ merchant_id: this.merchantId, authority }),
      });
      body = (await res.json()) as ZarinpalRefundResponse;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Zarinpal refund failed for authority ${authority}: ${message}`);
      throw new Error(`Zarinpal refund failed: ${message}`);
    }
    // Same policy as verifyPayment: a decline-shaped answer (normal HTTP, non-success
    // code) returns success:false; an infrastructure failure (non-ok HTTP) throws so
    // callers leave the payment refund_pending for the retry job.
    if (!res.ok) {
      this.logger.error(`Zarinpal refund returned HTTP ${res.status} for authority ${authority}: ${JSON.stringify(body.errors ?? body.data)}`);
      throw new Error(`Zarinpal refund failed: HTTP ${res.status} ${JSON.stringify(body.errors ?? body.data)}`);
    }
    if (body.data?.code === 100 || body.data?.code === 101) {
      return { success: true, refundRefId: body.data.ref_id != null ? String(body.data.ref_id) : null };
    }
    return { success: false, refundRefId: null };
  }
}
