import { PayamakYabSmsProvider } from './payamakyab-sms.provider';

// Exact shape from the panel's own documented sample response (WebService-Send.pdf) --
// ns1:-prefixed tags, "<status>-<recId>" on success.
function soapResponse(resultInner: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="http://tempuri.org/">
  <SOAP-ENV:Body>
    <ns1:SendSimpleSMSResponse>
      <ns1:SendSimpleSMSResult>${resultInner}</ns1:SendSimpleSMSResult>
    </ns1:SendSimpleSMSResponse>
  </SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;
}

describe('PayamakYabSmsProvider', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it('posts a SOAP envelope to the .asmx endpoint with the SendSimpleSMS SOAPAction', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => soapResponse('0-1782738475') });
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await provider.send('09121234567', 'hello');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://p.1000sms.ir/Post/Send.asmx');
    expect(init.method).toBe('POST');
    expect(init.headers['SOAPAction']).toBe('http://tempuri.org/SendSimpleSMS');
    expect(init.headers['Content-Type']).toContain('text/xml');
  });

  it('embeds username/password/sender/message, and strips the phone\'s leading zero', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => soapResponse('0-1') });
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await provider.send('09121234567', 'your booking is confirmed');

    const body: string = fetchMock.mock.calls[0][1].body;
    expect(body).toContain('<username>voltan</username>');
    expect(body).toContain('<password>secret</password>');
    expect(body).toContain('<from>10000767</from>');
    expect(body).toContain('<to>9121234567</to>');
    expect(body).not.toContain('<to>09121234567</to>');
    expect(body).toContain('<text>your booking is confirmed</text>');
  });

  it('XML-escapes message content (e.g. a salon name containing special characters)', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => soapResponse('0-1') });
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await provider.send('09121234567', 'سالن "مو و رنگ" <ویژه>');

    const body: string = fetchMock.mock.calls[0][1].body;
    expect(body).toContain('&quot;مو و رنگ&quot;');
    expect(body).toContain('&lt;ویژه&gt;');
    expect(body).not.toContain('<ویژه>');
  });

  it('treats "<status>-<recId>" as success regardless of the leading status digit', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => soapResponse('0-1782738475') });
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await expect(provider.send('09121234567', 'hi')).resolves.toBeUndefined();
  });

  it('throws a specific, real message for a bare failure code (e.g. bad credentials)', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => soapResponse('0') });
    const provider = new PayamakYabSmsProvider('voltan', 'wrong', '10000767');

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow(/نام کاربری یا رمز عبور/);
  });

  it('throws a specific message for insufficient credit (code 2)', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => soapResponse('2') });
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow(/اعتبار کافی نیست/);
  });

  it('throws when the response has no recognizable SendSimpleSMSResult tag', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => '<html>not a soap response</html>' });
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow('unrecognized response');
  });

  it('throws when the result is neither a known failure code nor a "status-recId" pair', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => soapResponse('garbage') });
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow('unrecognized result');
  });

  it('throws on a non-2xx HTTP response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Server Error' });
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow('HTTP 500');
  });

  it('normalizes a network-level fetch failure into the same error shape', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow('PayamakYab send failed');
  });

  it('surfaces the real underlying cause of a fetch failure, not just the generic "fetch failed"', async () => {
    // Node's undici gives every network-level failure the same generic top-level
    // message -- the actual reason (DNS, connection refused, TLS, ...) lives on
    // `.cause`, which this codebase already lost once in production.
    fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause: new Error('getaddrinfo ENOTFOUND p.1000sms.ir') }));
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow(/ENOTFOUND p\.1000sms\.ir/);
  });

  it('retries once on a network-level failure and succeeds if the retry lands', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed', { cause: new Error('getaddrinfo EAI_AGAIN p.1000sms.ir') }))
      .mockResolvedValueOnce({ ok: true, text: async () => soapResponse('0-1') });
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await expect(provider.send('09121234567', 'hi')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws (does not retry) on a non-2xx HTTP response -- deterministic, retrying changes nothing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal Server Error' });
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow('HTTP 500');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws (does not retry) on a business-logic failure code from the panel', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => soapResponse('2') });
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow(/اعتبار کافی نیست/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds the request with a network timeout', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => soapResponse('0-1') });
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

    await provider.send('09121234567', 'hi');

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it('logs the recId on a successful send (never the message text, which may carry a real OTP code)', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => soapResponse('0-1782738475') });
    const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');
    const logSpy = jest.spyOn(provider['logger'], 'log');

    await provider.send('09121234567', 'کد تایید شما در قیچی: 654321');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('recId=1782738475'));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('phone=9121234567'));
    expect(logSpy.mock.calls[0][0]).not.toContain('654321');
  });

  describe('sendOtp', () => {
    it('composes a Persian OTP message and sends it through the same SendSimpleSMS call', async () => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => soapResponse('0-1') });
      const provider = new PayamakYabSmsProvider('voltan', 'secret', '10000767');

      await provider.sendOtp('09121234567', '654321');

      const body: string = fetchMock.mock.calls[0][1].body;
      expect(body).toContain('654321');
      expect(body).toContain('<to>9121234567</to>');
    });
  });
});
