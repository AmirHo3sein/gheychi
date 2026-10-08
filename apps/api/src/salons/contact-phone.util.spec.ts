import { CONTACT_PHONE_PATTERN, normalizeContactPhone } from './contact-phone.util';

describe('normalizeContactPhone', () => {
  it.each([
    ['۰۹۱۲۳۴۵۶۷۸۹', '09123456789'],
    ['٠٩١٢٣٤٥٦٧٨٩', '09123456789'],
    ['0912 345-6789', '09123456789'],
    ['021-8888 7777', '02188887777'],
  ])('normalises %p to %p', (input, expected) => {
    expect(normalizeContactPhone(input)).toBe(expected);
  });

  it.each(['', null, '  - '])('clears on %p', (input) => {
    expect(normalizeContactPhone(input)).toBeNull();
  });

  it('leaves a non-string for the validators to reject', () => {
    expect(normalizeContactPhone(912)).toBe(912);
  });
});

describe('CONTACT_PHONE_PATTERN', () => {
  it.each(['09123456789', '02188887777', '07112345678'])('accepts %s', (v) => {
    expect(CONTACT_PHONE_PATTERN.test(v)).toBe(true);
  });
  it.each(['9123456789', '0912345678', '091234567890', '00123456789', '09a23456789', '+989123456789', '09123456789 '])(
    'rejects %s',
    (v) => {
      expect(CONTACT_PHONE_PATTERN.test(v)).toBe(false);
    },
  );
});
