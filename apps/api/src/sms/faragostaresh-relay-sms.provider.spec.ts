import { FaragostareshRelaySmsProvider } from './faragostaresh-relay-sms.provider';

describe('FaragostareshRelaySmsProvider', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it('posts JSON with the bearer token, and strips the phone\'s leading zero', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ result: true, data: {}, error: { message: '' } }) });
    const provider = new FaragostareshRelaySmsProvider();

    await provider.send('09121234567', 'hello');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://www.faragostaresh.com/sms/send.php');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer 7f3c9a2e8b1d46f0a5c7e9d2b8f14a63');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ mobile: '9121234567', message: 'hello لغو 11' });
  });

  it('appends the required لغو 11 opt-out footer to every message, regardless of content', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ result: true, data: {}, error: { message: '' } }) });
    const provider = new FaragostareshRelaySmsProvider();

    await provider.send('09121234567', 'نوبت شما در سالن، ساعت ۱۰ لغو شد.');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.message).toBe('نوبت شما در سالن، ساعت ۱۰ لغو شد. لغو 11');
  });

  it('resolves on result:true', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ result: true, data: {}, error: { message: '' } }) });
    const provider = new FaragostareshRelaySmsProvider();

    await expect(provider.send('09121234567', 'hi')).resolves.toBeUndefined();
  });

  it('logs the raw provider_response on success (never data.message, which echoes the real text back)', async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => ({
        result: true,
        data: {
          mobile: '9121234567',
          message: 'کد تایید شما در قیچی: 654321',
          provider_response: { SendSmsResult: 1, recId: { long: '2122594150' }, status: { byte: 0 } },
        },
        error: { message: '' },
      }),
    });
    const provider = new FaragostareshRelaySmsProvider();
    const logSpy = jest.spyOn(provider['logger'], 'log');

    await provider.send('09121234567', 'کد تایید شما در قیچی: 654321');

    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('2122594150'));
    expect(logSpy.mock.calls[0][0]).not.toContain('654321');
  });

  it('throws with the relay\'s own error message on result:false', async () => {
    fetchMock.mockResolvedValue({
      status: 502,
      json: async () => ({ result: false, data: [], error: { message: 'Insufficient SMS credit.' } }),
    });
    const provider = new FaragostareshRelaySmsProvider();

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow('Insufficient SMS credit.');
  });

  it('throws on a non-JSON response instead of silently swallowing it', async () => {
    fetchMock.mockResolvedValue({ status: 500, json: async () => { throw new Error('Unexpected token'); } });
    const provider = new FaragostareshRelaySmsProvider();

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow('non-JSON response');
  });

  it('normalizes a network-level fetch failure into the same error shape', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    const provider = new FaragostareshRelaySmsProvider();

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow('Faragostaresh relay send failed');
  });

  it('surfaces the real underlying cause of a fetch failure, not just the generic "fetch failed"', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed', { cause: new Error('getaddrinfo EAI_AGAIN www.faragostaresh.com') }));
    const provider = new FaragostareshRelaySmsProvider();

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow(/EAI_AGAIN www\.faragostaresh\.com/);
  });

  it('retries once on a network-level failure and succeeds if the retry lands', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce({ status: 200, json: async () => ({ result: true, data: {}, error: { message: '' } }) });
    const provider = new FaragostareshRelaySmsProvider();

    await expect(provider.send('09121234567', 'hi')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws (does not retry) on the relay\'s own business-logic failure -- deterministic, retrying changes nothing', async () => {
    fetchMock.mockResolvedValue({ status: 502, json: async () => ({ result: false, data: [], error: { message: 'Insufficient SMS credit.' } }) });
    const provider = new FaragostareshRelaySmsProvider();

    await expect(provider.send('09121234567', 'hi')).rejects.toThrow('Insufficient SMS credit.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds the request with a network timeout', async () => {
    fetchMock.mockResolvedValue({ status: 200, json: async () => ({ result: true, data: {}, error: { message: '' } }) });
    const provider = new FaragostareshRelaySmsProvider();

    await provider.send('09121234567', 'hi');

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  describe('sendOtp', () => {
    it('composes a Persian OTP message and relays it through the same send call', async () => {
      fetchMock.mockResolvedValue({ status: 200, json: async () => ({ result: true, data: {}, error: { message: '' } }) });
      const provider = new FaragostareshRelaySmsProvider();

      await provider.sendOtp('09121234567', '654321');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.mobile).toBe('9121234567');
      expect(body.message).toContain('654321');
    });
  });
});
