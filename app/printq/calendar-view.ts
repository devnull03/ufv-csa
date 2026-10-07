// Pure layout model for the week calendar: turns CalendarData into weeks of
// day columns with block positions in local minutes. Shared by server and client.
import type { CalendarBlock, CalendarData } from "./calendar";
import { addLocalDays, compareLocalDates, fromLocal, localDateOf, toLocal, weekdayOf, type LocalDate } from "./scheduling/time";

export interface DayBlock extends CalendarBlock {
  top: number; // minutes from grid start
  height: number; // minutes
}

export interface DayColumn {
  key: string;
  date: LocalDate;
  start: Date;
  end: Date;
  dow: string;
  dayNumber: number;
  isToday: boolean;
  isPast: boolean;
  windows: { top: number; height: number }[];
  blocks: DayBlock[];
  closedLabel: string | null;
  // Minutes from grid start already in the past (today only).
  pastUntil: number | null;
}

export interface WeekModel {
  label: string;
  days: DayColumn[];
}

export interface CalendarModel {
  hourStart: number;
  hourEnd: number;
  weeks: WeekModel[];
  nowTop: number | null;
  nowWeek: number | null;
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const dateKey = (date: LocalDate) => `${date.year}-${date.month}-${date.day}`;

/** Monday 00:00 (local) of the week containing `date`. */
export function weekStart(date: Date, timeZone: string): Date {
  const local = localDateOf(date, timeZone);
  const monday = addLocalDays(local, -((weekdayOf(local) + 6) % 7));
  return fromLocal({ ...monday, hour: 0, minute: 0 }, timeZone);
}

function weekLabel(first: LocalDate, last: LocalDate) {
  const left = `${MONTH[first.month - 1]} ${first.day}`;
  const right = first.month === last.month ? `${last.day}` : `${MONTH[last.month - 1]} ${last.day}`;
  return `${left} – ${right}, ${last.year}`;
}

export function buildCalendar(data: CalendarData, options: { weeks?: number; defaultHours?: [number, number] } = {}): CalendarModel {
  const { timeZone } = data;
  const now = new Date(data.now);
  const today = localDateOf(now, timeZone);
  const minutesOf = (date: Date) => {
    const local = toLocal(date, timeZone);
    return local.hour * 60 + local.minute;
  };

  // Grid spans whole hours covering every lab-hours window.
  let [hourStart, hourEnd] = options.defaultHours ?? [10, 18];
  if (data.windows.length > 0) {
    hourStart = Math.min(...data.windows.map((w) => Math.floor(minutesOf(new Date(w.start)) / 60)));
    hourEnd = Math.max(
      ...data.windows.map((w) => {
        const end = new Date(w.end);
        const sameDay = dateKey(localDateOf(end, timeZone)) === dateKey(localDateOf(new Date(w.start), timeZone));
        return sameDay ? Math.ceil(minutesOf(end) / 60) : 24;
      })
    );
  }
  const gridStart = hourStart * 60;
  const gridEnd = hourEnd * 60;

  const clip = (start: Date, end: Date, dayStart: Date, dayEnd: Date) => {
    const from = Math.max(start.getTime(), dayStart.getTime());
    const to = Math.min(end.getTime(), dayEnd.getTime());
    if (to <= from) return null;
    const top = Math.max(gridStart, minutesOf(new Date(from))) - gridStart;
    const bottom = to === dayEnd.getTime() ? gridEnd : Math.min(gridEnd, minutesOf(new Date(to)));
    const height = bottom - gridStart - top;
    return height > 0 ? { top, height } : null;
  };

  const firstMonday = localDateOf(weekStart(new Date(data.rangeStart), timeZone), timeZone);
  const lastDay = localDateOf(new Date(new Date(data.rangeEnd).getTime() - 1), timeZone);
  const weekCount = options.weeks ?? Math.max(1, Math.ceil((daysBetween(firstMonday, lastDay) + 1) / 7));

  const weeks: WeekModel[] = [];
  let nowTop: number | null = null;
  let nowWeek: number | null = null;
  for (let w = 0; w < weekCount; w++) {
    const days: DayColumn[] = [];
    for (let d = 0; d < 7; d++) {
      const date = addLocalDays(firstMonday, w * 7 + d);
      const start = fromLocal({ ...date, hour: 0, minute: 0 }, timeZone);
      const end = fromLocal({ ...addLocalDays(date, 1), hour: 0, minute: 0 }, timeZone);
      const windows = data.windows
        .map((window) => clip(new Date(window.start), new Date(window.end), start, end))
        .filter((value): value is { top: number; height: number } => value !== null);
      const blocks = data.blocks
        .map((block) => {
          const position = clip(new Date(block.start), new Date(block.end), start, end);
          return position ? { ...block, ...position } : null;
        })
        .filter((value): value is DayBlock => value !== null);
      const isToday = compareLocalDates(date, today) === 0;
      const isPast = compareLocalDates(date, today) < 0;
      const closure = blocks.find((block) => block.kind === "closure" && block.label);
      if (isToday) {
        const minute = minutesOf(now);
        if (minute >= gridStart && minute <= gridEnd) {
          nowTop = minute - gridStart;
          nowWeek = w;
        }
      }
      days.push({
        key: dateKey(date),
        date,
        start,
        end,
        dow: DOW[weekdayOf(date)],
        dayNumber: date.day,
        isToday,
        isPast,
        windows,
        blocks: blocks.filter((block) => !(windows.length === 0 && block.kind === "closure")),
        closedLabel: windows.length === 0 ? closure?.label ?? "Lab closed" : null,
        pastUntil: isPast ? gridEnd - gridStart : isToday ? Math.min(gridEnd, Math.max(gridStart, minutesOf(now))) - gridStart : null,
      });
    }
    weeks.push({ label: weekLabel(days[0].date, days[6].date), days });
  }
  return { hourStart, hourEnd, weeks, nowTop, nowWeek };
}

function daysBetween(a: LocalDate, b: LocalDate) {
  return Math.round((Date.UTC(b.year, b.month - 1, b.day) - Date.UTC(a.year, a.month - 1, a.day)) / 86_400_000);
}

/** First moment at or after `now` inside lab hours that no booking or maintenance covers. */
export function nextFreeTime(data: CalendarData): { at: Date; windowEnd: Date } | null {
  const now = new Date(data.now).getTime();
  const busy = data.blocks
    .filter((block) => block.kind !== "closure")
    .map((block) => ({ start: new Date(block.start).getTime(), end: new Date(block.end).getTime() }));
  const windows = data.windows
    .map((window) => ({ start: new Date(window.start).getTime(), end: new Date(window.end).getTime() }))
    .sort((a, b) => a.start - b.start);
  for (const window of windows) {
    let cursor = Math.max(window.start, now);
    while (cursor < window.end) {
      const blocking = busy.find((block) => block.start <= cursor && cursor < block.end);
      if (!blocking) return { at: new Date(cursor), windowEnd: new Date(window.end) };
      cursor = blocking.end;
    }
  }
  return null;
}

/** When the next booking or maintenance starts after `now`, within today's lab hours. */
export function busyFrom(data: CalendarData, from: Date): Date | null {
  const starts = data.blocks
    .filter((block) => block.kind !== "closure")
    .map((block) => new Date(block.start))
    .filter((start) => start > from)
    .sort((a, b) => a.getTime() - b.getTime());
  return starts[0] ?? null;
}

/** Lab-hour minutes between `from` and `to` that no booking or maintenance covers. */
export function freeMinutes(data: CalendarData, from: Date, to: Date): { minutes: number; days: number } {
  const busy = data.blocks
    .filter((block) => block.kind !== "closure")
    .map((block) => ({ start: new Date(block.start).getTime(), end: new Date(block.end).getTime() }));
  let total = 0;
  const days = new Set<string>();
  for (const window of data.windows) {
    const start = Math.max(new Date(window.start).getTime(), from.getTime());
    const end = Math.min(new Date(window.end).getTime(), to.getTime());
    if (end <= start) continue;
    let free = end - start;
    for (const block of busy) free -= Math.max(0, Math.min(end, block.end) - Math.max(start, block.start));
    if (free >= 15 * 60_000) {
      // Overlapping blocks (maintenance over a booking) can't make time negative.
      total += free;
      days.add(new Date(start).toDateString());
    }
  }
  return { minutes: Math.round(total / 60_000), days: days.size };
}
