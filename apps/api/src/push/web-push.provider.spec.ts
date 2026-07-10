import webpush from 'web-push';
import { WebPushProvider } from './web-push.provider';

jest.mock('web-push', () => ({
  __esModule: true,
  default: {
    setVapidDetails: jest.fn(),
    sendNotification: jest.fn(),
  },
}));

describe('WebPushProvider', () => {
  const mockedWebpush = webpush as jest.Mocked<typeof webpush>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sets VAPID details on construction', () => {
    new WebPushProvider('public-key', 'private-key', 'mailto:test@example.com');
    expect(mockedWebpush.setVapidDetails).toHaveBeenCalledWith('mailto:test@example.com', 'public-key', 'private-key');
  });

  it('sends a notification with the subscription, JSON payload, and a request timeout', async () => {
    mockedWebpush.sendNotification.mockResolvedValue({} as never);
    const provider = new WebPushProvider('public-key', 'private-key', 'mailto:test@example.com');
    await provider.send(
      { endpoint: 'https://push.example.com/abc', p256dh: 'p256dh-key', auth: 'auth-key' },
      { title: 'سلام', body: 'نوبت شما تایید شد' },
    );

    expect(mockedWebpush.sendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://push.example.com/abc', keys: { p256dh: 'p256dh-key', auth: 'auth-key' } },
      JSON.stringify({ title: 'سلام', body: 'نوبت شما تایید شد' }),
      { timeout: 10_000 },
    );
  });

  it('rethrows a send failure after logging it', async () => {
    mockedWebpush.sendNotification.mockRejectedValue(new Error('410 Gone'));
    const provider = new WebPushProvider('public-key', 'private-key', 'mailto:test@example.com');
    await expect(
      provider.send({ endpoint: 'https://push.example.com/abc', p256dh: 'k', auth: 'a' }, { title: 't', body: 'b' }),
    ).rejects.toThrow('410 Gone');
  });
});
