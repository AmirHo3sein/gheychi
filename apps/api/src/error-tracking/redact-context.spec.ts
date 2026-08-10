import { redactExtra } from './redact-context';

describe('redactExtra', () => {
  it('returns undefined unchanged', () => {
    expect(redactExtra(undefined)).toBeUndefined();
  });

  it('passes through an object with no sensitive-looking keys unchanged', () => {
    expect(redactExtra({ bookingId: 'b-1', salonId: 's-1', count: 3 })).toEqual({
      bookingId: 'b-1',
      salonId: 's-1',
      count: 3,
    });
  });

  it.each([
    'password',
    'Password',
    'jwt',
    'accessToken',
    'access_token',
    'refreshToken',
    'cookie',
    'session',
    'authorization',
    'Authorization',
    'otp',
    'cvv',
    'cardNumber',
    'apiKey',
    'privateKey',
    'secret',
  ])('redacts a known-sensitive key: %s', (key) => {
    const result = redactExtra({ [key]: 'super-secret-value' });
    expect(result![key]).toBe('[redacted]');
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
  });

  it('redacts a sensitive field nested inside a plain object', () => {
    const result = redactExtra({ user: { id: 'u-1', password: 'hunter2' } });
    expect(result).toEqual({ user: { id: 'u-1', password: '[redacted]' } });
  });

  it('redacts a sensitive field nested inside an array of objects', () => {
    const result = redactExtra({ items: [{ bookingId: 'b-1' }, { authorization: 'Bearer eyJhbGciOi' }] });
    expect(result).toEqual({ items: [{ bookingId: 'b-1' }, { authorization: '[redacted]' }] });
  });

  it('never mutates the input object', () => {
    const input = { password: 'hunter2', nested: { token: 'abc' } };
    const snapshot = JSON.parse(JSON.stringify(input));

    redactExtra(input);

    expect(input).toEqual(snapshot);
  });

  it('does not redact a field whose name merely resembles a safe field', () => {
    const result = redactExtra({ route: '/api/bookings/mine', requestId: 'req-1', userId: 'u-1' });
    expect(result).toEqual({ route: '/api/bookings/mine', requestId: 'req-1', userId: 'u-1' });
  });

  it('bounds recursion depth against a pathologically deep payload instead of throwing', () => {
    let deep: Record<string, unknown> = { leaf: 'value' };
    for (let i = 0; i < 20; i++) {
      deep = { nested: deep };
    }
    expect(() => redactExtra(deep)).not.toThrow();
  });
});
