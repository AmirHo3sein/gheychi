import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BOOKING_LIMIT_KEY_BOUNDS, REQUIRED_PLATFORM_CONFIG_KEYS } from '../platform-config/platform-config.service';
import { UpdateConfigDto } from '../platform-config/dto/admin-config.dto';

// The two abuse-cap keys: the read path (platform-config.service) and the write path
// (admin-config.dto) must agree on bounds, or a value the admin API accepts would brick the
// next boot. These tests pin both sides against the contract: 1-50 and 1-20, whole numbers.
async function errorsFor(key: string, value: number) {
  const dto = plainToInstance(UpdateConfigDto, { updates: [{ key, value }] });
  return validate(dto);
}

describe('booking abuse-cap config keys', () => {
  it('are required (boot-checked and listed by GET /admin/config)', () => {
    expect(REQUIRED_PLATFORM_CONFIG_KEYS).toEqual(
      expect.arrayContaining(['booking_max_active_per_user', 'booking_max_active_per_salon_per_user']),
    );
  });

  it('read-path bounds match the contract', () => {
    expect(BOOKING_LIMIT_KEY_BOUNDS).toEqual({
      booking_max_active_per_user: { min: 1, max: 50 },
      booking_max_active_per_salon_per_user: { min: 1, max: 20 },
    });
  });

  it.each([
    ['booking_max_active_per_user', 1, true],
    ['booking_max_active_per_user', 50, true],
    ['booking_max_active_per_user', 0, false],
    ['booking_max_active_per_user', 51, false],
    ['booking_max_active_per_user', 2.5, false],
    ['booking_max_active_per_salon_per_user', 1, true],
    ['booking_max_active_per_salon_per_user', 20, true],
    ['booking_max_active_per_salon_per_user', 0, false],
    ['booking_max_active_per_salon_per_user', 21, false],
    ['booking_max_active_per_salon_per_user', -1, false],
  ])('write path: %s = %s is %s', async (key, value, ok) => {
    expect((await errorsFor(key, value)).length === 0).toBe(ok);
  });
});
