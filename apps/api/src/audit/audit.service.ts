import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from './audit-log.entity';

export interface AuditEntry {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  payload: unknown;
  success: boolean;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(@InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>) {}

  /**
   * Inserts one audit row. Catches its own failures -- an audit-log outage must
   * never fail the admin's request (spec §5: strictly non-blocking side effect).
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.auditLogs.insert({
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        // TypeORM's QueryDeepPartialEntity recurses into object-typed columns; an
        // index-signature type like Record<string, unknown> | null doesn't satisfy
        // that recursive shape structurally, so the jsonb payload needs an `any`
        // escape here. Runtime behavior is unaffected -- pg driver serializes it as-is.
        payload: (entry.payload ?? null) as any,
        success: entry.success,
      });
    } catch (err) {
      this.logger.error(`Failed to write audit row for ${entry.action}: ${(err as Error).message}`);
    }
  }
}
