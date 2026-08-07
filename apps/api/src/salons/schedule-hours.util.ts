import { HourRangeDto } from './dto/schedule.dto';

/**
 * Finds the first pair of submitted working-hour ranges that overlap on the SAME weekday
 * (e.g. Monday 09:00-13:00 and Monday 12:00-17:00). `openTime`/`closeTime` are zero-padded
 * `HH:MM` strings (enforced by HourRangeDto's own regex), which sort lexically identically
 * to chronological order for same-day times -- no Date parsing needed. Two ranges overlap
 * (touching at a shared boundary does NOT count as overlapping -- 09:00-12:00 followed by
 * 12:00-17:00 is a valid back-to-back schedule) exactly when `a.open < b.close && b.open <
 * a.close`. Returns null when the whole submitted set is overlap-free.
 */
export function findOverlappingHourRanges(hours: HourRangeDto[]): [HourRangeDto, HourRangeDto] | null {
  const byWeekday = new Map<number, HourRangeDto[]>();
  for (const range of hours) {
    const existing = byWeekday.get(range.weekday);
    if (existing) existing.push(range);
    else byWeekday.set(range.weekday, [range]);
  }

  for (const ranges of byWeekday.values()) {
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i]!;
        const b = ranges[j]!;
        if (a.openTime < b.closeTime && b.openTime < a.closeTime) {
          return [a, b];
        }
      }
    }
  }
  return null;
}
