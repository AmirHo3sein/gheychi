export const PAYMENT_GATEWAY = 'PAYMENT_GATEWAY';

export interface PaymentRequestResult {
  authority: string;
  paymentUrl: string;
}

export interface PaymentVerifyResult {
  success: boolean;
  refId: string | null;
}

export interface PaymentRefundResult {
  success: boolean;
  refundRefId: string | null;
}

export interface PaymentGateway {
  requestPayment(amountToman: number, description: string, callbackUrl: string): Promise<PaymentRequestResult>;
  verifyPayment(authority: string, amountToman: number): Promise<PaymentVerifyResult>;
  refundPayment(authority: string): Promise<PaymentRefundResult>;
}
