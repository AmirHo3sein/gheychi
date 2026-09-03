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
 * service") when WE call it with the exact same panel credentials that work for him
 * from his own server -- strongly suggesting a per-method IP allowlist
 * he hasn't added our server to yet, not a real code problem on our side.
 *
 * Until that's sorted directly with the panel, this relays through a small PHP
 * endpoint the panel owner already runs on his own (presumably allowlisted) server,
 * which internally calls the real SendSms method for us. This is not a second
 * PayamakYabSmsProvider reimplementation -- it's a plain REST/JSON proxy to
 * someone else's server, with none of the SOAP-envelope logic that class has.
 */
const RELAY_URL = 'https://www.faragostaresh.com/sms/send.php';
const RELAY_TIMEOUT_MS = 15_000;

// The line behind this relay silently drops (SendSmsResult reports success, but
// GetDelivery/actual delivery fails) any message that doesn't carry this standard
// Iranian SMS opt-out footer -- confirmed by directly comparing a working Postman
// call (message ended in "... لغو 11") against every one of our own failing sends
// (no footer). Appended here, once, so it covers every message type this provider
// ever sends (OTP, cancellations, confirmations, ...), not just OTP.
const OPT_OUT_FOOTER = 'لغو 11';

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

  // The bearer token is a real credential on someone else's server and this repo is
  // public -- it MUST come from the environment (FARAGOSTARESH_RELAY_TOKEN), never a
  // literal here. An earlier revision hardcoded it; that value is burned and was rotated.
  constructor(private readonly relayToken: string) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    await this.send(phone, `کد تایید شما در قیچی: ${code}`);
  }

  async send(phone: string, message: string): Promise<void> {
    const bareMobile = toBareMobile(phone);
    const footedMessage = `${message} ${OPT_OUT_FOOTER}`;
    const res = await this.post(bareMobile, footedMessage);
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

  // Same scoped retry as PayamakYabSmsProvider's own post() -- ONE retry, only for a
  // network-level failure (fetch() itself throwing: DNS/connect/TLS), never for an
  // HTTP error or the relay's own business-logic failure (bad token, provider error,
  // ...), which are deterministic. This class shipped without this the first time and
  // a real request hit exactly the same transient DNS flakiness (a bare, undiagnosable
  // "fetch failed") already fixed once in the PayamakYab provider -- carrying the same
  // protection over here from the start would have caught it.
  private async post(bareMobile: string, message: string): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fetch(RELAY_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.relayToken}`,
          },
          body: JSON.stringify({ mobile: bareMobile, message }),
          signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt < 2) {
          this.logger.warn(`Network-level failure on attempt ${attempt}, retrying once: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        const cause = err instanceof Error && 'cause' in err ? err.cause : undefined;
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`Faragostaresh relay send failed: ${detail}${cause ? ` (cause: ${String(cause)})` : ''}`);
      }
    }
  }
}
