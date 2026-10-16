import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ListSalonBookingsQueryDto } from './booking.dto';

const errorsFor = async (query: Record<string, string>) =>
  validate(plainToInstance(ListSalonBookingsQueryDto, query), { whitelist: true });

// The window bounds are instants. A bare date or an offset-less date-time would be read by
// `new Date()` as UTC midnight or as the SERVER's local time respectively -- for a Tehran
// salon that silently drops (or adds) up to 3.5 hours of bookings at each edge, and the
// result depends on the host's TZ. Both are refused so the caller states the offset.
describe('ListSalonBookingsQueryDto', () => {
  it.each(['2026-10-15T20:30:00.000Z', '2026-10-16T00:00:00+03:30', '2026-10-16T00:00:00.000+0330'])(
    'accepts a full instant with an explicit offset: %s',
    async (from) => {
      expect(await errorsFor({ from, to: '2026-10-17T00:00:00+03:30' })).toHaveLength(0);
    },
  );

  it.each(['2026-10-16', '2026-10-16T00:00:00', '2026-10-16T00:00'])(
    'rejects a bound without a time zone offset: %s',
    async (value) => {
      expect(await errorsFor({ from: value })).not.toHaveLength(0);
      expect(await errorsFor({ to: value })).not.toHaveLength(0);
    },
  );

  it('still accepts no window at all (unfiltered listing)', async () => {
    expect(await errorsFor({})).toHaveLength(0);
  });

  it('still rejects garbage', async () => {
    expect(await errorsFor({ from: 'yesterday' })).not.toHaveLength(0);
  });
});
