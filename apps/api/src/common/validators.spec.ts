import { IRAN_MOBILE } from './validators';

describe('IRAN_MOBILE', () => {
  it('matches a well-formed Iranian mobile number', () => {
    expect(IRAN_MOBILE.test('09121234567')).toBe(true);
  });

  it.each(['9121234567', '0912123456', '091212345678', '0812345678', 'not-a-phone'])(
    'rejects %s',
    (value) => {
      expect(IRAN_MOBILE.test(value)).toBe(false);
    },
  );
});
