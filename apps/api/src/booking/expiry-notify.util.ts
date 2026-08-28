/**
 * Bounded-concurrency fan-out for the expiry jobs' post-commit notifications.
 *
 * Both expiry jobs can retire up to 1000 bookings in one tick. Notifying them strictly one
 * at a time means ~1000 sequential SMS round-trips; at a few hundred milliseconds each that
 * is many minutes, while the job still holds a cron lock whose default TTL is 60 seconds —
 * so the lock would expire mid-run and a second instance's next tick could start a
 * concurrent run. (It could not double-expire anything, because the status CAS still
 * protects that, but it would double-notify customers.)
 *
 * A small concurrency window keeps the wall-clock bounded without turning a batch into a
 * burst against the SMS provider. Each task is fully isolated: one failure never rejects
 * the whole fan-out and never stops the remaining notifications, matching the
 * "already committed, must not fail the run" contract these call sites have.
 */
export const NOTIFY_CONCURRENCY = 10;

export async function notifyAllBoundedly(
  ids: string[],
  notify: (id: string) => Promise<void>,
  onError: (id: string, err: unknown) => void,
  concurrency: number = NOTIFY_CONCURRENCY,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, ids.length) }, async () => {
    // Each worker pulls the next index rather than taking a fixed slice, so one slow
    // recipient can't leave a whole pre-assigned chunk waiting behind it.
    for (;;) {
      const index = cursor++;
      if (index >= ids.length) return;
      const id = ids[index]!;
      try {
        await notify(id);
      } catch (err) {
        onError(id, err);
      }
    }
  });
  await Promise.all(workers);
}
