import { formatIranDateTimeFa } from '../src/common/iran-time.util';
import {
  escapeTelegramHtml,
  formatReleaseMessage,
  parseArgs,
  readTelegramEnvConfig,
  ReleaseInfo,
  sendReleaseNotification,
  sendTelegramMessage,
} from './notify-telegram-release';

const BASE_RELEASE: ReleaseInfo = {
  version: 'v1.2.0',
  fromRef: 'v1.1.0',
  toRef: 'v1.2.0',
  environment: 'Production',
  commitSha: 'a1b2c3d',
  migrationCount: 2,
  changelog: [
    { category: 'Features', subject: 'Add provider payout export' },
    { category: 'Fixes', subject: 'Fix double-booking on concurrent requests' },
    { category: 'Chores', subject: 'Bump typeorm to 0.3.25' },
  ],
  // Fixed instant so the rendered Tehran-local date/time is deterministic across CI/local runs.
  deployedAt: new Date('2026-08-12T10:00:00.000Z'),
};

describe('escapeTelegramHtml', () => {
  it('escapes &, <, > but leaves other characters untouched', () => {
    expect(escapeTelegramHtml('A & B <script> "quoted" \'x\'')).toBe(
      'A &amp; B &lt;script&gt; "quoted" \'x\'',
    );
  });

  it('escapes a commit-subject-shaped dangerous string', () => {
    const subject = 'Fix <b>bold</b> injection & "quotes" in title > footer';
    expect(escapeTelegramHtml(subject)).toBe(
      'Fix &lt;b&gt;bold&lt;/b&gt; injection &amp; "quotes" in title &gt; footer',
    );
  });
});

describe('formatReleaseMessage', () => {
  it('renders the expected HTML structure for a known input (snapshot-style)', () => {
    const message = formatReleaseMessage(BASE_RELEASE);

    expect(message).toContain('🚀 <b>New Release Deployed</b>');
    expect(message).toContain('<b>Version:</b> v1.2.0');
    expect(message).toContain('<b>Environment:</b> Production');
    expect(message).toContain('<b>Status:</b> ✅ Deployed');
    expect(message).toContain('<b>Commit:</b> <code>a1b2c3d</code>');
    expect(message).toContain('<b>Migrations:</b> 2 applied');
    expect(message).toContain('<b>Changelog (v1.1.0 → v1.2.0):</b>');
    expect(message).toContain('<b>✨ Features</b>');
    expect(message).toContain('• Add provider payout export');
    expect(message).toContain('<b>🐛 Fixes</b>');
    expect(message).toContain('• Fix double-booking on concurrent requests');
    expect(message).toContain('<b>🔧 Chores</b>');
    expect(message).toContain('• Bump typeorm to 0.3.25');

    // Full structural snapshot, built against the shared iran-time.util formatter directly
    // (rather than a hand-typed Persian-calendar guess) so it can't drift from what that
    // module actually renders while still pinning the exact overall HTML structure.
    const expectedDate = formatIranDateTimeFa(BASE_RELEASE.deployedAt);
    expect(message).toBe(
      [
        '🚀 <b>New Release Deployed</b>',
        '',
        '<b>Version:</b> v1.2.0',
        '<b>Environment:</b> Production',
        '<b>Status:</b> ✅ Deployed',
        `<b>Date:</b> ${expectedDate}`,
        '<b>Commit:</b> <code>a1b2c3d</code>',
        '<b>Migrations:</b> 2 applied',
        '',
        '<b>Changelog (v1.1.0 → v1.2.0):</b>',
        '<b>✨ Features</b>',
        '• Add provider payout export',
        '',
        '<b>🐛 Fixes</b>',
        '• Fix double-booking on concurrent requests',
        '',
        '<b>🔧 Chores</b>',
        '• Bump typeorm to 0.3.25',
      ].join('\n'),
    );
  });

  it('escapes dangerous characters in a commit subject inside the rendered changelog', () => {
    const release: ReleaseInfo = {
      ...BASE_RELEASE,
      changelog: [{ category: 'Fixes', subject: 'Fix <script>alert(1)</script> & "XSS" > here' }],
    };
    const message = formatReleaseMessage(release);
    expect(message).not.toContain('<script>');
    expect(message).toContain('Fix &lt;script&gt;alert(1)&lt;/script&gt; &amp; "XSS" &gt; here');
  });

  it('shows "none" for zero migrations and omits the count phrase', () => {
    const message = formatReleaseMessage({ ...BASE_RELEASE, migrationCount: 0 });
    expect(message).toContain('<b>Migrations:</b> none');
  });

  it('renders a placeholder when the changelog is empty', () => {
    const message = formatReleaseMessage({ ...BASE_RELEASE, changelog: [] });
    expect(message).toContain('<i>No changes recorded.</i>');
  });

  it('stays within the 4096-char Telegram limit and never exceeds it', () => {
    const message = formatReleaseMessage(BASE_RELEASE);
    expect(message.length).toBeLessThanOrEqual(4096);
  });
});

describe('formatReleaseMessage truncation', () => {
  it('truncates the changelog (not the header) when the message would exceed 4096 chars, and closes all HTML tags', () => {
    const hugeChangelog = Array.from({ length: 500 }, (_, i) => ({
      category: i % 2 === 0 ? 'Features' : 'Fixes',
      subject: `Some reasonably long commit subject describing change number ${i} in detail`,
    }));
    const release: ReleaseInfo = { ...BASE_RELEASE, changelog: hugeChangelog };
    const message = formatReleaseMessage(release);

    expect(message.length).toBeLessThanOrEqual(4096);
    // Header must survive intact.
    expect(message).toContain('🚀 <b>New Release Deployed</b>');
    expect(message).toContain('<b>Version:</b> v1.2.0');
    // Truncation marker present.
    expect(message).toMatch(/<i>\.\.\. \(\d+ more changes\)<\/i>/);
    // Every opened tag must be closed -- count occurrences of each tag pair.
    for (const tag of ['b', 'i', 'code']) {
      const openCount = (message.match(new RegExp(`<${tag}>`, 'g')) ?? []).length;
      const closeCount = (message.match(new RegExp(`</${tag}>`, 'g')) ?? []).length;
      expect(closeCount).toBe(openCount);
    }
    // Never cuts a tag mid-way: no dangling "<" without a matching ">" before the next "<".
    expect(message).not.toMatch(/<[a-zA-Z/][^>]*$/);
  });

  it('never truncates when the changelog already fits', () => {
    const message = formatReleaseMessage(BASE_RELEASE);
    expect(message).not.toContain('more changes');
  });
});

describe('readTelegramEnvConfig', () => {
  it('is disabled unless the flag is exactly the string "true"', () => {
    expect(readTelegramEnvConfig({ TELEGRAM_RELEASE_NOTIFICATIONS_ENABLED: 'false' } as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(readTelegramEnvConfig({ TELEGRAM_RELEASE_NOTIFICATIONS_ENABLED: 'TRUE' } as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(readTelegramEnvConfig({} as NodeJS.ProcessEnv).enabled).toBe(false);
    expect(readTelegramEnvConfig({ TELEGRAM_RELEASE_NOTIFICATIONS_ENABLED: 'true' } as NodeJS.ProcessEnv).enabled).toBe(true);
  });
});

describe('parseArgs', () => {
  it('parses required flags and defaults --environment to Production', () => {
    expect(parseArgs(['--version', 'v1.2.0', '--from', 'v1.1.0', '--to', 'v1.2.0'])).toEqual({
      version: 'v1.2.0',
      from: 'v1.1.0',
      to: 'v1.2.0',
      environment: 'Production',
    });
  });

  it('honors an explicit --environment', () => {
    expect(
      parseArgs(['--version', 'v1.2.0', '--from', 'a', '--to', 'b', '--environment', 'Staging']).environment,
    ).toBe('Staging');
  });

  it('throws a usage error when a required flag is missing', () => {
    expect(() => parseArgs(['--from', 'a', '--to', 'b'])).toThrow(/Usage:/);
  });
});

describe('sendTelegramMessage', () => {
  it('posts to the correct URL with the correct body and headers on success', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    const result = await sendTelegramMessage('FAKE_TOKEN', '12345', '<b>hi</b>', { fetchFn });

    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botFAKE_TOKEN/sendMessage');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(init.body)).toEqual({ chat_id: '12345', text: '<b>hi</b>', parse_mode: 'HTML' });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not retry on a 4xx and reports the response body', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"ok":false,"description":"Unauthorized"}',
    });
    const delayFn = jest.fn().mockResolvedValue(undefined);
    const result = await sendTelegramMessage('BAD_TOKEN', '12345', 'text', { fetchFn, delayFn });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(delayFn).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('HTTP 401');
    expect(result.reason).toContain('Unauthorized');
  });

  it('retries up to 2 times with backoff on a 5xx, then gives up', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'server error' });
    const delayFn = jest.fn().mockResolvedValue(undefined);
    const result = await sendTelegramMessage('TOKEN', '12345', 'text', { fetchFn, delayFn });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(delayFn).toHaveBeenCalledTimes(2);
    expect(delayFn.mock.calls[0][0]).toBe(1000);
    expect(delayFn.mock.calls[1][0]).toBe(3000);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('HTTP 500');
  });

  it('retries on a network rejection and eventually reports failure without throwing', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    const delayFn = jest.fn().mockResolvedValue(undefined);
    const result = await sendTelegramMessage('TOKEN', '12345', 'text', { fetchFn, delayFn });

    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('ECONNRESET');
  });

  it('succeeds on the second attempt after one network failure', async () => {
    const fetchFn = jest
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => 'ok' });
    const delayFn = jest.fn().mockResolvedValue(undefined);
    const result = await sendTelegramMessage('TOKEN', '12345', 'text', { fetchFn, delayFn });

    expect(result).toEqual({ ok: true });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('sendReleaseNotification -- MUST NEVER throw / MUST NEVER signal a failing exit', () => {
  // This is the single most important property of the whole script: per the deploy spec,
  // a failed Telegram notification MUST NOT fail the deployment. Every scenario below
  // exercises a distinct failure mode and asserts the promise always resolves (never
  // rejects), which is what lets the CLI entry point always process.exit(0).

  it('resolves cleanly when notifications are disabled (env var unset)', async () => {
    const log = jest.fn();
    const errorLog = jest.fn();
    await expect(
      sendReleaseNotification(BASE_RELEASE, {} as NodeJS.ProcessEnv, { log, errorLog }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('skipping notification'));
  });

  it('resolves cleanly when notifications are disabled (env var explicitly "false")', async () => {
    await expect(
      sendReleaseNotification(
        BASE_RELEASE,
        { TELEGRAM_RELEASE_NOTIFICATIONS_ENABLED: 'false' } as NodeJS.ProcessEnv,
        { log: jest.fn(), errorLog: jest.fn() },
      ),
    ).resolves.toBeUndefined();
  });

  it('resolves cleanly when enabled but bot token is missing, and never logs a token value', async () => {
    const errorLog = jest.fn();
    await expect(
      sendReleaseNotification(
        BASE_RELEASE,
        { TELEGRAM_RELEASE_NOTIFICATIONS_ENABLED: 'true', TELEGRAM_CHAT_ID: '123' } as NodeJS.ProcessEnv,
        { log: jest.fn(), errorLog },
      ),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('TELEGRAM_BOT_TOKEN'));
  });

  it('resolves cleanly when enabled but chat id is missing', async () => {
    await expect(
      sendReleaseNotification(
        BASE_RELEASE,
        { TELEGRAM_RELEASE_NOTIFICATIONS_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'tok' } as NodeJS.ProcessEnv,
        { log: jest.fn(), errorLog: jest.fn() },
      ),
    ).resolves.toBeUndefined();
  });

  it('resolves cleanly when fetch rejects on every attempt (network failure)', async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error('network down'));
    const delayFn = jest.fn().mockResolvedValue(undefined);
    const errorLog = jest.fn();
    await expect(
      sendReleaseNotification(
        BASE_RELEASE,
        { TELEGRAM_RELEASE_NOTIFICATIONS_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '123' } as NodeJS.ProcessEnv,
        { fetchFn, delayFn, log: jest.fn(), errorLog },
      ),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('Failed to send'));
    // Token value must never appear in any logged string.
    for (const call of errorLog.mock.calls) {
      expect(String(call[0])).not.toContain('tok');
    }
  });

  it('resolves cleanly on a 401 Unauthorized response (bad token)', async () => {
    const fetchFn = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"ok":false,"description":"Unauthorized"}',
    });
    const errorLog = jest.fn();
    await expect(
      sendReleaseNotification(
        BASE_RELEASE,
        { TELEGRAM_RELEASE_NOTIFICATIONS_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '123' } as NodeJS.ProcessEnv,
        { fetchFn, log: jest.fn(), errorLog },
      ),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('401'));
  });

  it('resolves cleanly on a 429/5xx exhausting all retries', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'unavailable' });
    const delayFn = jest.fn().mockResolvedValue(undefined);
    await expect(
      sendReleaseNotification(
        BASE_RELEASE,
        { TELEGRAM_RELEASE_NOTIFICATIONS_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '123' } as NodeJS.ProcessEnv,
        { fetchFn, delayFn, log: jest.fn(), errorLog: jest.fn() },
      ),
    ).resolves.toBeUndefined();
  });

  it('resolves cleanly on an abort/timeout', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const fetchFn = jest.fn().mockRejectedValue(abortError);
    const delayFn = jest.fn().mockResolvedValue(undefined);
    const errorLog = jest.fn();
    await expect(
      sendReleaseNotification(
        BASE_RELEASE,
        { TELEGRAM_RELEASE_NOTIFICATIONS_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '123' } as NodeJS.ProcessEnv,
        { fetchFn, delayFn, log: jest.fn(), errorLog },
      ),
    ).resolves.toBeUndefined();
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining('timed out'));
  });

  it('resolves cleanly even on success (sanity check the happy path also never throws)', async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true, status: 200, text: async () => 'ok' });
    await expect(
      sendReleaseNotification(
        BASE_RELEASE,
        { TELEGRAM_RELEASE_NOTIFICATIONS_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '123' } as NodeJS.ProcessEnv,
        { fetchFn, log: jest.fn(), errorLog: jest.fn() },
      ),
    ).resolves.toBeUndefined();
  });
});
