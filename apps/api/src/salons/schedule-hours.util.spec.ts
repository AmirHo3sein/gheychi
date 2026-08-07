import { findOverlappingHourRanges } from './schedule-hours.util';

function range(weekday: number, openTime: string, closeTime: string) {
  return { weekday, openTime, closeTime };
}

describe('findOverlappingHourRanges', () => {
  it('returns null for a schedule with no overlaps at all', () => {
    const hours = [range(1, '09:00', '13:00'), range(1, '14:00', '18:00'), range(2, '09:00', '17:00')];
    expect(findOverlappingHourRanges(hours)).toBeNull();
  });

  it('detects two overlapping ranges on the same weekday (Monday 09:00-13:00 and 12:00-17:00)', () => {
    const hours = [range(1, '09:00', '13:00'), range(1, '12:00', '17:00')];
    const overlap = findOverlappingHourRanges(hours);
    expect(overlap).not.toBeNull();
    expect(overlap).toEqual([range(1, '09:00', '13:00'), range(1, '12:00', '17:00')]);
  });

  it('does not flag ranges on DIFFERENT weekdays with the same clock times', () => {
    const hours = [range(1, '09:00', '13:00'), range(2, '09:00', '13:00')];
    expect(findOverlappingHourRanges(hours)).toBeNull();
  });

  it('does not flag back-to-back ranges that only touch at a shared boundary', () => {
    // 09:00-12:00 followed immediately by 12:00-17:00 is a valid, common schedule --
    // touching at the boundary instant is not an overlap.
    const hours = [range(1, '09:00', '12:00'), range(1, '12:00', '17:00')];
    expect(findOverlappingHourRanges(hours)).toBeNull();
  });

  it('detects a range fully contained inside another', () => {
    const hours = [range(3, '08:00', '20:00'), range(3, '10:00', '11:00')];
    expect(findOverlappingHourRanges(hours)).not.toBeNull();
  });

  it('detects the overlap regardless of submission order', () => {
    const hours = [range(1, '12:00', '17:00'), range(1, '09:00', '13:00')];
    expect(findOverlappingHourRanges(hours)).toEqual([range(1, '12:00', '17:00'), range(1, '09:00', '13:00')]);
  });

  it('finds an overlap among three-or-more ranges on the same weekday, even when only two of them collide', () => {
    const hours = [range(5, '08:00', '10:00'), range(5, '10:30', '12:00'), range(5, '11:00', '13:00')];
    const overlap = findOverlappingHourRanges(hours);
    expect(overlap).toEqual([range(5, '10:30', '12:00'), range(5, '11:00', '13:00')]);
  });

  it('returns null for an empty schedule', () => {
    expect(findOverlappingHourRanges([])).toBeNull();
  });
});
