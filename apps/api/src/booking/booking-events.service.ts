import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BookingEvent, BookingEventActorType, BookingEventType } from './booking-event.entity';

export interface RecordBookingEventInput {
  bookingId: string;
  eventType: BookingEventType;
  actorType: BookingEventActorType;
  actorId?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Writes the append-only booking lifecycle log.
 *
 * Two deliberate contracts, mirroring how the rest of this codebase treats
 * observability writes:
 *
 * 1. `record()` NEVER throws. A booking must never fail, and money must never be left
 *    in a half-applied state, because a history row couldn't be written. Failures are
 *    logged with a greppable prefix instead. This is the same posture AuditService
 *    already takes (`AUDIT_WRITE_FAILED`).
 *
 * 2. When a caller passes its own `em`, the write joins that caller's transaction and
 *    is therefore rolled back with it. That is the correct behaviour: an event
 *    describing a transition that got rolled back would be actively misleading in a
 *    support investigation. Callers who want the event to survive regardless (e.g.
 *    recording a *failed* attempt) simply omit `em`.
 */
@Injectable()
export class BookingEventsService {
  private readonly logger = new Logger(BookingEventsService.name);

  constructor(@InjectRepository(BookingEvent) private readonly events: Repository<BookingEvent>) {}

  async record(input: RecordBookingEventInput, em?: EntityManager): Promise<void> {
    try {
      const repo = em ? em.getRepository(BookingEvent) : this.events;
      await repo.save(
        repo.create({
          bookingId: input.bookingId,
          eventType: input.eventType,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          metadata: input.metadata ?? null,
        }),
      );
    } catch (err) {
      // Deliberately swallowed -- see the class doc comment. Note that when `em` was
      // supplied this catch does NOT save the caller's transaction: the failed
      // statement has already poisoned it and the caller's own commit will fail. That
      // is accepted and correct; what this guarantees is only that *this* service is
      // never the thing that throws.
      this.logger.error(
        `BOOKING_EVENT_WRITE_FAILED booking=${input.bookingId} event=${input.eventType}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Batch form of `record()`, for the expiry crons.
   *
   * They can retire up to 1000 bookings in a single tick and write two events for each;
   * as individual `record()` calls that is 2000 sequential round-trips inside one open
   * transaction, which is enough on its own to push the job past its 60-second cron lock.
   * One multi-row INSERT keeps the transaction short. Same never-throws contract.
   */
  async recordMany(inputs: RecordBookingEventInput[], em?: EntityManager): Promise<void> {
    if (inputs.length === 0) return;
    try {
      const repo = em ? em.getRepository(BookingEvent) : this.events;
      // save() over an array of new entities, not insert(): the jsonb `metadata` column is
      // typed as a plain Record, which TypeORM's QueryDeepPartialEntity treats as a nested
      // relation shape rather than a value. save() takes the real entity type and still
      // batches the write.
      await repo.save(
        inputs.map((input) =>
          repo.create({
            bookingId: input.bookingId,
            eventType: input.eventType,
            actorType: input.actorType,
            actorId: input.actorId ?? null,
            metadata: input.metadata ?? null,
          }),
        ),
      );
    } catch (err) {
      this.logger.error(
        `BOOKING_EVENT_BATCH_WRITE_FAILED count=${inputs.length}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** One booking's full timeline, oldest first — the admin support view. */
  listForBooking(bookingId: string): Promise<BookingEvent[]> {
    return this.events.find({ where: { bookingId }, order: { createdAt: 'ASC' } });
  }
}
