// Minimal timezone helpers built on Intl so the engine has no date-library
// dependency. All Date values are absolute instants; "local" means wall-clock
// time in the given IANA zone.

export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

export interface LocalDateTime extends LocalDate {
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string) {
  let dtf = formatters.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, dtf);
  }
  return dtf;
}

export function toLocal(date: Date, timeZone: string): LocalDateTime & { second: number } {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
  };
}

function offsetMs(date: Date, timeZone: string) {
  const local = toLocal(date, timeZone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

// Converts a wall-clock time in `timeZone` to an instant. Times that fall in a
// DST gap resolve to the instant after the gap.
export function fromLocal(local: LocalDateTime, timeZone: string): Date {
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  const first = offsetMs(new Date(asUtc), timeZone);
  const candidate = asUtc - first;
  const second = offsetMs(new Date(candidate), timeZone);
  return new Date(second === first ? candidate : asUtc - second);
}

export function localDateOf(date: Date, timeZone: string): LocalDate {
  const { year, month, day } = toLocal(date, timeZone);
  return { year, month, day };
}

export function addLocalDays(date: LocalDate, days: number): LocalDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

export function weekdayOf(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function compareLocalDates(a: LocalDate, b: LocalDate) {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

export function parseClock(value: string): { hour: number; minute: number } {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) throw new Error(`Invalid clock time: ${value}`);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) {
    throw new Error(`Invalid clock time: ${value}`);
  }
  return { hour, minute };
}
