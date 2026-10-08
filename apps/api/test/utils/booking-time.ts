import { DataSource } from 'typeorm';

/**
 * Moves a booking's appointment into the past so the salon can record its outcome.
 *
 * `completed` is refused before the appointment starts (BookingsService.updateStatus), and
 * `no_show` additionally needs the no-show grace period to have elapsed -- and an e2e test
 * cannot wait hours. Booking in the past is not possible through the API (startsAt must be
 * in the future), so the test rewinds the row directly, exactly like production time
 * passing. Defaults to 3h ago: past the seeded 30-minute no-show grace.
 */
export async function startBookingInThePast(ds: DataSource, bookingId: string, minutesAgo = 180): Promise<void> {
  await ds.query(
    `UPDATE bookings
        SET starts_at = now() - make_interval(mins => $2),
            ends_at = now() - make_interval(mins => $2) + interval '30 minutes'
      WHERE id = $1`,
    [bookingId, minutesAgo],
  );
}
