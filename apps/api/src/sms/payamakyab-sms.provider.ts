import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms.provider';

// A plain SOAP 1.1 (.asmx) web service, not REST -- no client library dependency exists
// in this codebase for that, and the one method this needs (SendSimpleSMS) has a small
// enough, stable enough contract that hand-rolling the envelope (matching
// KavenegarSmsProvider's own plain-fetch style) is simpler than adding one just for this.
//
// p.1000sms.ir, NOT the panel's other domain (smspanel.payamakyab.com) -- same backend
// account (confirmed via a live GetCredit call returning the identical balance from
// both), but smspanel.payamakyab.com's TLS certificate is expired; this domain's is
// valid. Never point this back at the expired-cert domain, even temporarily -- this
// class deliberately does not weaken certificate validation, so that domain hard-fails
// every request.
const PAYAMAKYAB_URL = 'https://p.1000sms.ir/Post/Send.asmx';
const PAYAMAKYAB_TIMEOUT_MS = 10_000;

// SendSimpleSMSResult's own documented contract: on success it's "<deliveryStatus>-
// <recId>" (e.g. "0-1782780631" -- 0 meaning "handed to the carrier", recId a tracking
// id this codebase never needs since nothing here polls GetDelivery); on failure it's a
// BARE status code with no dash at all. The two "0"s are NOT the same thing -- a bare
// "0" is failure (bad username/password), while "0-<anything>" is success -- so success
// is detected structurally (contains a dash), and failure only by exact match against
// this known list.
const FAILURE_MESSAGES: Record<string, string> = {
  '0': 'نام کاربری یا رمز عبور صحیح نیست',
  '2': 'اعتبار کافی نیست',
  '3': 'محدودیت در ارسال روزانه',
  '4': 'محدودیت در حجم ارسال',
  '5': 'شماره فرستنده معتبر نیست یا غیرفعال است',
  '6': 'شماره موبایل صحیح جهت ارسال وجود ندارد',
  '7': 'متن پیامک خالی است',
  '8': 'کاربر ارسال‌کننده غیرفعال است',
  '9': 'تعداد شماره‌ها بیش از حد مجاز است',
  '100': 'مجاز به استفاده از وب سرویس نیستید',
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// The panel's own sample payloads use bare 10-digit numbers ("912xxxxxxx", no leading
// zero, no +98) -- this codebase stores phones as 09xxxxxxxxx everywhere else, so this is
// the one seam that needs to strip the leading zero to match what the panel documents.
function toBareMobile(phone: string): string {
  return phone.startsWith('0') ? phone.slice(1) : phone;
}

function buildEnvelope(username: string, password: string, from: string, to: string, text: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <SendSimpleSMS xmlns="http://tempuri.org/">
      <username>${escapeXml(username)}</username>
      <password>${escapeXml(password)}</password>
      <from>${escapeXml(from)}</from>
      <to>${escapeXml(to)}</to>
      <text>${escapeXml(text)}</text>
      <isflash>false</isflash>
    </SendSimpleSMS>
  </soap:Body>
</soap:Envelope>`;
}

// Tolerant of an `ns1:`/any-prefix or unprefixed tag -- the docs' own sample response
// screenshots show the prefixed form (<ns1:SendSimpleSMSResult>), but ASP.NET .asmx
// services are also known to answer unprefixed depending on how the client declares its
// namespace; matching both is cheap and avoids a fragile assumption either way.
function extractResult(xml: string): string | null {
  const match = xml.match(/<(?:[\w.-]+:)?SendSimpleSMSResult>([^<]*)<\/(?:[\w.-]+:)?SendSimpleSMSResult>/);
  return match ? match[1].trim() : null;
}

@Injectable()
export class PayamakYabSmsProvider implements SmsProvider {
  private readonly logger = new Logger('PayamakYabSmsProvider');

  constructor(
    private readonly username: string,
    private readonly password: string,
    private readonly sender: string,
  ) {}

  async sendOtp(phone: string, code: string): Promise<void> {
    await this.send(phone, `کد تایید شما در قیچی: ${code}`);
  }

  async send(phone: string, message: string): Promise<void> {
    const bareMobile = toBareMobile(phone);
    const envelope = buildEnvelope(this.username, this.password, this.sender, bareMobile, message);
    const res = await this.post(envelope);
    const body = await res.text();
    if (!res.ok) {
      throw new Error(`PayamakYab send failed: HTTP ${res.status} -- ${body.slice(0, 300)}`);
    }
    const result = extractResult(body);
    if (result === null) {
      throw new Error(`PayamakYab send failed: unrecognized response -- ${body.slice(0, 300)}`);
    }
    if (FAILURE_MESSAGES[result] !== undefined) {
      throw new Error(`PayamakYab send failed: ${FAILURE_MESSAGES[result]} (code ${result})`);
    }
    if (!/^\d+-\d+$/.test(result)) {
      throw new Error(`PayamakYab send failed: unrecognized result "${result}"`);
    }
    // The panel accepting the send (a real recId, not a failure code) is NOT the same
    // as the phone actually receiving it -- logging the recId is what makes a later
    // GetDelivery lookup possible when a user reports "nothing arrived" despite this
    // codebase seeing a clean 201. Never the message text itself (it may carry a real
    // OTP code) -- phone + recId only.
    const [, recId] = result.split('-');
    this.logger.log(`Accepted by carrier: phone=${bareMobile} recId=${recId}`);
  }

  // ONE retry, and only for a network-level failure (DNS/connect/TLS -- the fetch()
  // call itself throwing) -- never for an HTTP error or the panel's own business-logic
  // failure codes (bad credentials, no credit, ...), which are deterministic and
  // retrying changes nothing. Confirmed in production this is worth doing: a real
  // getaddrinfo EAI_AGAIN (explicitly Node's "temporary" DNS failure code, not a
  // permanent NXDOMAIN) on one request, immediately followed by 8/8 successful
  // lookups moments later -- OTP is synchronous and user-facing (the customer is
  // sitting on the login page right now), unlike this codebase's other external-
  // provider failures (e.g. ZarinpalGateway's refund path), which hand off to a
  // background cron job instead since nobody's waiting on those in real time.
  private async post(envelope: string): Promise<Response> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fetch(PAYAMAKYAB_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            SOAPAction: 'http://tempuri.org/SendSimpleSMS',
          },
          body: envelope,
          signal: AbortSignal.timeout(PAYAMAKYAB_TIMEOUT_MS),
        });
      } catch (err) {
        if (attempt < 2) {
          this.logger.warn(`Network-level failure on attempt ${attempt}, retrying once: ${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        // Node's undici gives a generic top-level message ("fetch failed") for every
        // network-level failure alike (DNS, connection refused, TLS, ...) -- the actual
        // reason lives on `.cause`, which a bare `err.message` silently drops. This is
        // exactly the gap that turned a real, specific network error into an
        // undiagnosable "fetch failed" in production once already.
        const cause = err instanceof Error && 'cause' in err ? err.cause : undefined;
        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(`PayamakYab send failed: ${detail}${cause ? ` (cause: ${String(cause)})` : ''}`);
      }
    }
  }
}
