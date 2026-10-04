import { clipIntervals, mergeIntervals, overlaps, subtractIntervals, type Interval } from "./intervals";
import { addLocalDays, compareLocalDates, fromLocal, localDateOf, parseClock, weekdayOf } from "./time";

export interface WeeklyHours {
  weekday: number; // 0 = Sunday
  opensAt: string; // "HH:MM" local
  closesAt: string; // "HH:MM" local
}

export interface Slot {
  start: Date;
  end: Date;
  // The print continues after the lab-hours window it started in.
  runsPastClose: boolean;
}

const MINUTE = 60_000;

/**
 * Instants within [range.start, range.end) when a print may start: the weekly
 * lab hours expanded into concrete windows, minus closures.
 */
export function labWindows(
  range: Interval,
  weeklyHours: WeeklyHours[],
  closures: Interval[],
  timeZone: string
): Interval[] {
  const windows: Interval[] = [];
  const last = addLocalDays(localDateOf(range.end, timeZone), 1);
  for (
    let day = addLocalDays(localDateOf(range.start, timeZone), -1);
    compareLocalDates(day, last) <= 0;
    day = addLocalDays(day, 1)
  ) {
    const weekday = weekdayOf(day);
    for (const hours of weeklyHours) {
      if (hours.weekday !== weekday) continue;
      windows.push({
        start: fromLocal({ ...day, ...parseClock(hours.opensAt) }, timeZone),
        end: fromLocal({ ...day, ...parseClock(hours.closesAt) }, timeZone),
      });
    }
  }
  return subtractIntervals(clipIntervals(mergeIntervals(windows), range), closures);
}

/** Booked duration: slicer estimate plus padding plus buffer, rounded up to the slot step. */
export function bookedDurationMinutes(
  printSeconds: number,
  { paddingPct, bufferMinutes }: { paddingPct: number; bufferMinutes: number },
  stepMinutes: number
): number {
  if (!Number.isFinite(printSeconds) || printSeconds <= 0) {
    throw new Error("Print time must be a positive number of seconds");
  }
  const raw = (printSeconds / 60) * (1 + paddingPct / 100) + bufferMinutes;
  return Math.ceil(raw / stepMinutes) * stepMinutes;
}

export interface AvailableStartsQuery {
  windows: Interval[];
  busy: Interval[];
  durationMinutes: number;
  stepMinutes: number;
  earliestStart: Date;
  mustFinishInLabHours: boolean;
}

export function availableStarts(query: AvailableStartsQuery): Slot[] {
  const stepMs = query.stepMinutes * MINUTE;
  const durationMs = query.durationMinutes * MINUTE;
  const busy = mergeIntervals(query.busy);
  const slots: Slot[] = [];

  for (const window of mergeIntervals(query.windows)) {
    const from = Math.max(window.start.getTime(), query.earliestStart.getTime());
    // Aligning to the epoch keeps local quarter hours for zones with whole-hour offsets.
    for (let start = Math.ceil(from / stepMs) * stepMs; start < window.end.getTime(); start += stepMs) {
      const end = start + durationMs;
      const runsPastClose = end > window.end.getTime();
      if (runsPastClose && query.mustFinishInLabHours) break;
      const candidate = { start: new Date(start), end: new Date(end) };
      if (busy.some((block) => overlaps(block, candidate))) continue;
      slots.push({ ...candidate, runsPastClose });
    }
  }
  return slots;
}
