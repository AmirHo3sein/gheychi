import { AiService } from './ai.service';
import { AiProvider } from './ai.provider';

describe('AiService', () => {
  it('forwards prompt and options to the provider and returns its result unchanged', async () => {
    const complete = jest.fn().mockResolvedValue('a completion');
    const provider: AiProvider = { complete };
    const service = new AiService(provider);

    const result = await service.complete('hello', { model: 'x' });

    expect(complete).toHaveBeenCalledWith('hello', { model: 'x' });
    expect(result).toBe('a completion');
  });

  it('forwards a call with no options given', async () => {
    const complete = jest.fn().mockResolvedValue('ok');
    const provider: AiProvider = { complete };
    const service = new AiService(provider);

    await service.complete('hello');

    expect(complete).toHaveBeenCalledWith('hello', undefined);
  });

  it('propagates a provider failure (e.g. UnconfiguredAiProvider throwing) to its own caller', async () => {
    const complete = jest.fn().mockRejectedValue(new Error('not configured'));
    const provider: AiProvider = { complete };
    const service = new AiService(provider);

    await expect(service.complete('hello')).rejects.toThrow('not configured');
  });
});
