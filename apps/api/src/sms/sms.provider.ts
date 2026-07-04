export const SMS_PROVIDER = 'SMS_PROVIDER';

export interface SmsProvider {
  sendOtp(phone: string, code: string): Promise<void>;
}
