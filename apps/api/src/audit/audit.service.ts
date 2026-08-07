import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { User } from '../users/user.entity';
import { AuditLog } from './audit-log.entity';

export interface AuditEntry {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  payload: unknown;
  success: boolean;
}

export interface AuditLogQuery {
  actorId?: string;
  action?: string;
  targetType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export type AuditLogListItem = AuditLog & { actorPhone: string | null; actorName: string | null };

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog) private readonly auditLogs: Repository<AuditLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

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
      // No alerting (e.g. AlertsService/SMS paging) exists on audit failures -- wiring
      // that in here would pull AlertsModule's dependency chain back through
      // AuthModule -> AuditModule, a real module cycle, not just a refactor. Until that's
      // untangled, this pair of log lines is the only trace of a failed write, so both
      // are load-bearing: the ERROR line carries the full stack for debugging, and the
      // separate WARN line uses a fixed, greppable prefix specifically so an external
      // log-based monitor/alert rule (that watches for AUDIT_WRITE_FAILED, independent of
      // this app's own alerting) can page on it without parsing the free-form message.
      const message = (err as Error).message;
      this.logger.error(`Failed to write audit row for ${entry.action}: ${message}`, (err as Error).stack);
      this.logger.warn(
        `AUDIT_WRITE_FAILED action=${entry.action} targetType=${entry.targetType} targetId=${entry.targetId ?? 'null'} actorId=${entry.actorId}`,
      );
    }
  }

  async listForAdmin(
    query: AuditLogQuery,
  ): Promise<{ items: AuditLogListItem[]; total: number; page: number; pageSize: number }> {
    const where: Record<string, unknown> = {};
    if (query.actorId) where.actorId = query.actorId;
    if (query.action) where.action = query.action;
    if (query.targetType) where.targetType = query.targetType;
    if (query.from && query.to) where.createdAt = Between(new Date(query.from), new Date(query.to));
    else if (query.from) where.createdAt = MoreThanOrEqual(new Date(query.from));
    else if (query.to) where.createdAt = LessThanOrEqual(new Date(query.to));

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const [logs, total] = await this.auditLogs.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    // Second lookup instead of a QB join: entities carry no relation decorators
    // (repo convention), and one IN query over <=100 ids is cheap.
    const actorIds = [...new Set(logs.map((log) => log.actorId))];
    const actors = actorIds.length
      ? await this.users.find({ where: { id: In(actorIds) }, select: ['id', 'phone', 'name'] })
      : [];
    const actorById = new Map(actors.map((actor) => [actor.id, actor]));

    const items = logs.map((log) => ({
      ...log,
      actorPhone: actorById.get(log.actorId)?.phone ?? null,
      actorName: actorById.get(log.actorId)?.name ?? null,
    }));
    return { items, total, page, pageSize };
  }
}
