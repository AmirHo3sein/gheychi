import { KavenegarSmsProvider } from './kavenegar-sms.provider';

describe('KavenegarSmsProvider', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as never;
  });

  it('calls the verify/lookup endpoint with phone, code, and template', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ return: { status: 200 } }),
    });
    const provider = new KavenegarSmsProvider('MY_KEY', 'my-template');
    await provider.sendOtp('09121234567', '123456');

    const url: string = fetchMock.mock.calls[0][0];
    expect(url).toContain('/v1/MY_KEY/verify/lookup.json');
    expect(url).toContain('receptor=09121234567');
    expect(url).toContain('token=123456');
    expect(url).toContain('template=my-template');
  });

  it('throws when kavenegar reports failure', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ return: { status: 418, message: 'invalid' } }),
    });
    const provider = new KavenegarSmsProvider('MY_KEY', 'my-template');
    await expect(provider.sendOtp('09121234567', '123456')).rejects.toThrow();
  });
});
