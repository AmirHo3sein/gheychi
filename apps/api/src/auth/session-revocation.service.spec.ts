import { SessionRevocationService } from './session-revocation.service';

describe('SessionRevocationService', () => {
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  let redis: { set: jest.Mock; exists: jest.Mock };
  let service: SessionRevocationService;

  beforeEach(() => {
    redis = { set: jest.fn().mockResolvedValue('OK'), exists: jest.fn().mockResolvedValue(0) };
    service = new SessionRevocationService(redis as never);
  });

  it('stores a denylist entry that expires exactly when the token itself would have', async () => {
    await service.revoke('jti-1', nowSeconds() + 3600);

    const [key, value, mode, ttl] = redis.set.mock.calls[0];
    expect(key).toBe('session:revoked:jti-1');
    expect(value).toBe('1');
    expect(mode).toBe('EX');
    // Within a second of an hour -- the entry only has to outlive the token it blocks.
    expect(ttl).toBeGreaterThan(3595);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it('writes nothing for an already-expired token -- verifyAsync rejects it on its own', async () => {
    await service.revoke('jti-old', nowSeconds() - 60);

    expect(redis.set).not.toHaveBeenCalled();
  });

  it('reports a revoked session', async () => {
    redis.exists.mockResolvedValue(1);

    await expect(service.isRevoked('jti-1')).resolves.toBe(true);
    expect(redis.exists).toHaveBeenCalledWith('session:revoked:jti-1');
  });

  it('reports a session that was never revoked', async () => {
    await expect(service.isRevoked('jti-2')).resolves.toBe(false);
  });

  it('propagates a Redis failure rather than reporting "not revoked" (fail-closed)', async () => {
    redis.exists.mockRejectedValue(new Error('redis down'));

    await expect(service.isRevoked('jti-3')).rejects.toThrow('redis down');
  });
});
