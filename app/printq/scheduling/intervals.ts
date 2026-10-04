export interface Interval {
  start: Date;
  end: Date;
}

const ms = (date: Date) => date.getTime();

export function overlaps(a: Interval, b: Interval) {
  return ms(a.start) < ms(b.end) && ms(b.start) < ms(a.end);
}

export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals
    .filter((interval) => ms(interval.end) > ms(interval.start))
    .sort((a, b) => ms(a.start) - ms(b.start));
  const merged: Interval[] = [];
  for (const interval of sorted) {
    const last = merged[merged.length - 1];
    if (last && ms(interval.start) <= ms(last.end)) {
      if (ms(interval.end) > ms(last.end)) last.end = interval.end;
    } else {
      merged.push({ start: interval.start, end: interval.end });
    }
  }
  return merged;
}

export function subtractIntervals(base: Interval[], cuts: Interval[]): Interval[] {
  const mergedCuts = mergeIntervals(cuts);
  const result: Interval[] = [];
  for (const interval of mergeIntervals(base)) {
    let pieces: Interval[] = [interval];
    for (const cut of mergedCuts) {
      pieces = pieces.flatMap((piece) => {
        if (!overlaps(piece, cut)) return [piece];
        const remaining: Interval[] = [];
        if (ms(cut.start) > ms(piece.start)) remaining.push({ start: piece.start, end: cut.start });
        if (ms(cut.end) < ms(piece.end)) remaining.push({ start: cut.end, end: piece.end });
        return remaining;
      });
    }
    result.push(...pieces);
  }
  return result;
}

export function clipIntervals(intervals: Interval[], bounds: Interval): Interval[] {
  return intervals
    .filter((interval) => overlaps(interval, bounds))
    .map((interval) => ({
      start: ms(interval.start) < ms(bounds.start) ? bounds.start : interval.start,
      end: ms(interval.end) > ms(bounds.end) ? bounds.end : interval.end,
    }));
}
