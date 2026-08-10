import { redactSensitiveQueryParams } from './tracing-query-redaction.util';

describe('redactSensitiveQueryParams', () => {
  it('redacts Authority (Zarinpal payment gateway callback token), case-insensitively', () => {
    expect(redactSensitiveQueryParams('Authority=A00000000000000000000000012345&Status=OK')).toBe(
      'Authority=REDACTED&Status=OK',
    );
    expect(redactSensitiveQueryParams('authority=abc123')).toBe('authority=REDACTED');
  });

  it('redacts other known-sensitive param names', () => {
    expect(redactSensitiveQueryParams('token=abc&session_id=xyz&api_key=k1')).toBe(
      'token=REDACTED&session_id=REDACTED&api_key=REDACTED',
    );
  });

  it('leaves harmless params untouched', () => {
    expect(redactSensitiveQueryParams('code=REF12345&bookingId=abc-123&status=success')).toBe(
      'code=REF12345&bookingId=abc-123&status=success',
    );
  });

  it('passes through an empty query string unchanged', () => {
    expect(redactSensitiveQueryParams('')).toBe('');
  });
});
