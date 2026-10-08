import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateConfigDto } from './admin-config.dto';
import { UpdateFeatureFlagsDto } from './admin-feature-flags.dto';

const errorsFor = async (updates: unknown[]) =>
  validate(plainToInstance(UpdateConfigDto, { updates }), { whitelist: true });

describe('UpdateConfigDto -- config values that used to brick boot', () => {
  it.each([1441, 100000, -1, 2.5])('rejects no_show_grace_minutes=%s', async (value) => {
    expect((await errorsFor([{ key: 'no_show_grace_minutes', value }])).length).toBeGreaterThan(0);
  });

  // Each booking snapshots this into an INTEGER column: a fractional window would make every booking insert fail.
  it.each([1.5, 0.5, -1, 721])('rejects cancellation_window_hours=%s', async (value) => {
    expect((await errorsFor([{ key: 'cancellation_window_hours', value }])).length).toBeGreaterThan(0);
  });

  it.each([0, 24, 720])('accepts cancellation_window_hours=%s', async (value) => {
    expect(await errorsFor([{ key: 'cancellation_window_hours', value }])).toEqual([]);
  });

  it.each([0, 30, 1440])('accepts no_show_grace_minutes=%s', async (value) => {
    expect(await errorsFor([{ key: 'no_show_grace_minutes', value }])).toEqual([]);
  });

  it('rejects a number written into a feature-flag key', async () => {
    expect((await errorsFor([{ key: 'feature_reviews_enabled', value: 1 }])).length).toBeGreaterThan(0);
  });
});

describe('UpdateFeatureFlagsDto', () => {
  it.each([1, 'true', 'yes', {}])('rejects non-boolean flag value %p', async (value) => {
    const errors = await validate(plainToInstance(UpdateFeatureFlagsDto, { reviewsEnabled: value }));
    expect(errors.length).toBeGreaterThan(0);
  });
});
