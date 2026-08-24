import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms.provider';

/**
 * ============================================================================
 * TEMPORARY STOPGAP -- NOT the real fix. Switch back to PayamakYabSmsProvider
 * (SMS_PROVIDER=payamakyab) once the panel authorizes our own server's IP
 * (171.22.25.68) for the SendSms method.
 * ============================================================================
 *
 * Real background: PayamakYabSmsProvider (SendSimpleSMS) works but every message
 * it sends comes back GetDeliveryResult=9 ("blocked by the line owner") -- confirmed
 * three times, two different real phone numbers. The panel owner's own SendSms
 * (the "advanced" method) returns SendSmsResult=100 ("not authorized to use the web
 * service") when WE call it with the exact same voltan/anakin113071 credentials that
 * work for him from his own server -- strongly suggesting a per-method IP allowlist
 * he hasn't added our server to yet, not a real code problem on our side.
 *
 * Until that's sorted directly with the panel, this relays through a small PHP
 * endpoint the panel owner already runs on his own (presumably allowlisted) server,
 * which internally calls the real SendSms method for us. This is not a second
 * PayamakYabSmsProvider reimplementation -- it's a plain REST/JSON proxy to
 * someone else's server, with none of the SOAP-envelope logic that class has.
 */
const RELAY_URL = 'https://www.faragostaresh.com/sms/send.php';
const RELAY_TOKEN = '7f3c9a2e8b1d46f0a5c7e9d2b8f14a63';
const RELAY_TIMEOUT_MS = 15_000;

interface RelayResponse {
  result: boolean;
  data?: Record<string, unknown>;
  error?: { message?: string };
}

// Same convention as payamakyab-sms.provider.ts's own toBareMobile -- the relay's own
// validateMobile() requires exactly this shape (`/^9[0-9]{9}$/`), no leading zero.
function toBareMobile(phone: string): string {
  return phone.startsWith('0') ? phone.slice(1) : phone;
}

@Injectable()
export class FaragostareshRelaySmsProvider implements SmsProvider {
  private readonly logger = new Logger('FaragostareshRelaySmsProvider');

  async sendOtp(phone: string, code: string): Promise<void> {
    await this.send(phone, `کد تایید شما در قیچی: ${code}`);
  }

  async send(phone: string, message: string): Promise<void> {
    const bareMobile = toBareMobile(phone);
    let res: Response;
    try {
      res = await fetch(RELAY_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${RELAY_TOKEN}`,
        },
        body: JSON.stringify({ mobile: bareMobile, message }),
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      });
    } catch (err) {
      throw new Error(`Faragostaresh relay send failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    let body: RelayResponse;
    try {
      body = (await res.json()) as RelayResponse;
    } catch {
      throw new Error(`Faragostaresh relay send failed: HTTP ${res.status}, non-JSON response`);
    }
    if (!body.result) {
      throw new Error(`Faragostaresh relay send failed: ${body.error?.message ?? `HTTP ${res.status}`}`);
    }
    // The relay's own `result: true` only means the panel's SendSms call itself
    // returned success (SendSmsResult=1) -- it says nothing about whether the carrier
    // actually delivered it (confirmed: a user reported a clean success here with
    // nothing arriving on their phone). `provider_response` is the raw SendSms
    // response (send.php's own `$soapResult`), which carries the real per-recipient
    // recId GetDelivery needs to check actual delivery status -- logging it (never
    // `data.message`, which echoes the real text back and may carry a real OTP code)
    // is what makes that follow-up check possible.
    this.logger.log(`Relayed via faragostaresh: phone=${bareMobile} providerResponse=${JSON.stringify(body.data?.provider_response ?? null)}`);
  }
}
