import { NotImplementedException } from '@nestjs/common';
import { UnconfiguredAiProvider } from './unconfigured-ai.provider';

describe('UnconfiguredAiProvider', () => {
  it('throws NotImplementedException instead of returning a fabricated completion', async () => {
    const provider = new UnconfiguredAiProvider();

    await expect(provider.complete('فردا عصر یه آرایشگاه مردونه نزدیک ونک')).rejects.toBeInstanceOf(
      NotImplementedException,
    );
  });

  it('throws the same static, generic message regardless of the prompt given', async () => {
    const provider = new UnconfiguredAiProvider();

    await expect(provider.complete('summarize this booking')).rejects.toThrow(
      'AiProvider has no real implementation in this environment',
    );
  });

  it('never echoes the prompt or options back in the thrown error (nothing to redact, because nothing is ever transmitted)', async () => {
    const provider = new UnconfiguredAiProvider();
    const sensitivePrompt = 'user phone: 09121234567, secret token: eyJhbGciOiJIUzI1NiJ9.abc.def';

    try {
      await provider.complete(sensitivePrompt, { model: 'gpt-4', temperature: 0.2 });
      fail('expected complete() to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(NotImplementedException);
      const message = (err as NotImplementedException).message;
      expect(message).not.toContain(sensitivePrompt);
      expect(message).not.toContain('09121234567');
      expect(message).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(message).not.toContain('gpt-4');
    }
  });

  it('ignores completion options entirely rather than partially honoring them', async () => {
    const provider = new UnconfiguredAiProvider();

    await expect(provider.complete('anything', { model: 'x', temperature: 1, maxTokens: 100 })).rejects.toThrow(
      NotImplementedException,
    );
  });
});
