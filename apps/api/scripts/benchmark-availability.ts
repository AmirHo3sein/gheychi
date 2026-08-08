import 'reflect-metadata';
import { performance } from 'node:perf_hooks';
import { computeAvailableSlots, WorkingHourRange } from '../src/booking/availability.util';

const AVAILABILITY_WINDOW_DAYS = 14;
const SERVICE_DURATION_MIN = 45;
const SALON_CAPACITY = 3;
// Cumulative booking counts to benchmark at, in a single seed-more-and-remeasure pass
// -- not "typical" volumes but a deliberate stress ramp, since the whole point is to
// find out at what volume (if any) the in-memory filter in AvailabilityService starts
// to matter.
const BOOKING_COUNTS = [0, 50, 200, 1000, 5000];
const OWNER_PHONE = '09190000099';
const SALON_SLUG = 'benchmark-availability-salon';

const OPEN_ALL_WEEK: [number, WorkingHourRange[]][] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => [
  weekday,
  [{ openTime: '09:00', closeTime: '21:00' }],
]);

async function main(): Promise<void> {
  // Imported lazily, same reasoning as scripts/create-admin.ts: keeps dotenv/DataSource
  // construction out of any future spec importing helpers from this file.
  const { testDataSource } = await import('../test/utils/db');
  const ds = testDataSource();
  await ds.initialize();

  try {
    const [{ id: ownerId }] = await ds.query(`INSERT INTO users (phone, role) VALUES ($1, 'provider') RETURNING id`, [
      OWNER_PHONE,
    ]);
    const [{ id: salonId }] = await ds.query(
      `INSERT INTO salons (owner_id, name, slug, gender_target, status, address, city, location, capacity)
       VALUES ($1, 'Benchmark Salon', $2, 'women', 'approved', 'Addr', 'Tehran',
         ST_SetSRID(ST_MakePoint(51.4, 35.7), 4326)::geography, $3)
       RETURNING id`,
      [ownerId, SALON_SLUG, SALON_CAPACITY],
    );
    const [{ id: serviceId }] = await ds.query(
      `INSERT INTO salon_services (salon_id, category_id, name, price, duration_min)
       VALUES ($1, (SELECT id FROM service_categories ORDER BY id LIMIT 1), 'Cut', 500000, $2)
       RETURNING id`,
      [salonId, SERVICE_DURATION_MIN],
    );
    await ds.query(
      `INSERT INTO working_hours (salon_id, weekday, open_time, close_time) SELECT $1, generate_series(0, 6), '09:00', '21:00'`,
      [salonId],
    );

    console.log(`Availability benchmark -- salon ${salonId}, ${AVAILABILITY_WINDOW_DAYS}-day window, capacity ${SALON_CAPACITY}\n`);
    console.log('bookings | SQL fetch (ms) | JS filter (ms) | total (ms) | index used');
    console.log('---------|----------------|-----------------|------------|-----------');

    let seeded = 0;
    for (const target of BOOKING_COUNTS) {
      if (target > seeded) {
        // 3-minute spacing keeps `target` bookings (up to 5000) inside the 14-day
        // window (14*24*60/3 = 6720 available slots) without needing them to be
        // mutually non-overlapping -- this benchmark only cares about row VOLUME,
        // not double-booking correctness (that's computeAvailableSlots's own,
        // separately and extensively unit-tested, contract).
        await ds.query(
          `INSERT INTO bookings (salon_id, service_id, user_id, starts_at, ends_at, price_snapshot, deposit_amount, status)
           SELECT $1, $2, $3,
                  now() + (n * interval '3 minutes'),
                  now() + (n * interval '3 minutes') + ($4 || ' minutes')::interval,
                  500000, 100000, 'confirmed'
           FROM generate_series($5::int, $6::int) AS n`,
          [salonId, serviceId, ownerId, SERVICE_DURATION_MIN, seeded, target - 1],
        );
        seeded = target;
      }

      const now = new Date();
      const windowEnd = new Date(now.getTime() + AVAILABILITY_WINDOW_DAYS * 24 * 60 * 60_000);
      // Mirrors AvailabilityService.computeFor's exact booking-window query.
      const fetchSql = `
        SELECT starts_at, ends_at, worker_id FROM bookings
        WHERE salon_id = $1 AND status IN ('confirmed', 'pending_payment')
          AND starts_at < $2 AND ends_at > $3`;

      const t0 = performance.now();
      const bookingRows: Array<{ starts_at: Date; ends_at: Date; worker_id: string | null }> = await ds.query(fetchSql, [
        salonId,
        windowEnd,
        now,
      ]);
      const sqlMs = performance.now() - t0;

      const [explainRow] = await ds.query(`EXPLAIN (FORMAT JSON) ${fetchSql}`, [salonId, windowEnd, now]);
      const planJson = JSON.stringify(explainRow['QUERY PLAN']);
      const usesIndex = planJson.includes('bookings_salon_time_idx');

      const t1 = performance.now();
      computeAvailableSlots({
        now,
        days: AVAILABILITY_WINDOW_DAYS,
        durationMin: SERVICE_DURATION_MIN,
        capacity: SALON_CAPACITY,
        hoursByWeekday: new Map(OPEN_ALL_WEEK),
        exceptionsByDate: new Map(),
        existingBookings: bookingRows.map((b) => ({
          startsAt: new Date(b.starts_at),
          endsAt: new Date(b.ends_at),
          workerId: b.worker_id,
        })),
      });
      const jsMs = performance.now() - t1;

      console.log(
        `${String(seeded).padStart(8)} | ${sqlMs.toFixed(2).padStart(14)} | ${jsMs.toFixed(2).padStart(15)} | ${(sqlMs + jsMs).toFixed(2).padStart(10)} | ${usesIndex ? 'yes (index scan)' : 'NO -- seq scan!'}`,
      );
    }
  } finally {
    // FK-ordered cleanup -- none of these tables cascade from salons.
    await ds.query(`DELETE FROM bookings WHERE salon_id = (SELECT id FROM salons WHERE slug = $1)`, [SALON_SLUG]);
    await ds.query(`DELETE FROM working_hours WHERE salon_id = (SELECT id FROM salons WHERE slug = $1)`, [SALON_SLUG]);
    await ds.query(`DELETE FROM salon_services WHERE salon_id = (SELECT id FROM salons WHERE slug = $1)`, [SALON_SLUG]);
    await ds.query(`DELETE FROM salons WHERE slug = $1`, [SALON_SLUG]);
    await ds.query(`DELETE FROM users WHERE phone = $1`, [OWNER_PHONE]);
    await ds.destroy();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
