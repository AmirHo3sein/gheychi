import { FindOptionsWhere, In, Repository } from 'typeorm';

/**
 * Batch-resolves a set of ids to their entity's `name` field in ONE query (WHERE id IN
 * (...)) rather than a per-row lookup -- the "attach a display name to a list of rows"
 * idiom this codebase uses repeatedly for admin list screens (booking/salon/worker
 * names). Returns a plain id -> name Map; callers apply their own fallback via
 * `.get(id) ?? 'Unknown X'` at the point of use, since the right fallback string (and
 * whether a missing name is even possible) differs per call site.
 */
export async function resolveNamesById<T extends { id: string; name: string }>(
  repo: Repository<T>,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await repo.find({ where: { id: In(ids) } as FindOptionsWhere<T> });
  return new Map(rows.map((row) => [row.id, row.name]));
}
