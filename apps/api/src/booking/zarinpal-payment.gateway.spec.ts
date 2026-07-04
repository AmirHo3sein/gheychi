import { ZarinpalGateway } from './zarinpal-payment.gateway';

describe('ZarinpalGateway', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it('requests a payment with amount converted from toman to rial', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: 100, authority: 'AUTH123', message: 'ok' }, errors: [] }),
    });
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    const result = await gateway.requestPayment(200000, 'Deposit for Rose Beauty', 'https://api.example.com/callback');

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://payment.zarinpal.com/pg/v4/payment/request.json');
    const body = JSON.parse(options.body);
    expect(body.merchant_id).toBe('MERCHANT_ID');
    expect(body.amount).toBe(2000000); // 200000 toman * 10 = rial
    expect(body.callback_url).toBe('https://api.example.com/callback');
    expect(result.authority).toBe('AUTH123');
    expect(result.paymentUrl).toBe('https://payment.zarinpal.com/pg/StartPay/AUTH123');
  });

  it('throws when zarinpal reports a non-100 code on request', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: null, errors: [{ code: -9, message: 'Invalid merchant' }] }),
    });
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    await expect(gateway.requestPayment(200000, 'x', 'https://x.com/cb')).rejects.toThrow();
  });

  it('treats verify code 100 as success', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: 100, ref_id: 987654, message: 'ok' }, errors: [] }),
    });
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    const result = await gateway.verifyPayment('AUTH123', 200000);
    expect(result.success).toBe(true);
    expect(result.refId).toBe('987654');
  });

  it('treats verify code 101 (already verified) as success too', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: 101, ref_id: 987654, message: 'already verified' }, errors: [] }),
    });
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    const result = await gateway.verifyPayment('AUTH123', 200000);
    expect(result.success).toBe(true);
  });

  it('treats any other verify code as failure, not a thrown error', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { code: -50, message: 'not found' }, errors: [] }),
    });
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    const result = await gateway.verifyPayment('AUTH123', 200000);
    expect(result.success).toBe(false);
  });

  it('normalizes a network-level fetch failure into a thrown error', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    await expect(gateway.requestPayment(200000, 'x', 'https://x.com/cb')).rejects.toThrow('Zarinpal');
  });

  it('throws when verify returns a non-ok HTTP status, even if the body looks like a decline', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ data: null, errors: [{ code: -1, message: 'internal error' }] }),
    });
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    await expect(gateway.verifyPayment('AUTH123', 200000)).rejects.toThrow('Zarinpal');
  });

  it('wraps a malformed (non-JSON) response into a thrown Zarinpal error instead of a raw SyntaxError', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON');
      },
    });
    const gateway = new ZarinpalGateway('MERCHANT_ID');
    await expect(gateway.requestPayment(200000, 'x', 'https://x.com/cb')).rejects.toThrow('Zarinpal');
  });
});
