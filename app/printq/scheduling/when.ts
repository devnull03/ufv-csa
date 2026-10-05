// Parses the short date/time phrases staff type in Discord ("Fri 12:30-4pm",
// "Oct 9 all day", "tomorrow 2pm", "2026-10-09 10:00-12:00"). Pure; all times
// are wall-clock in the given zone.

import { addLocalDays, fromLocal, localDateOf, weekdayOf, type LocalDate } from "./time";

export class WhenParseError extends Error {}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export const WHEN_EXAMPLES = "`Fri 12:30-4pm`, `Oct 9 all day`, `today 2pm-3pm`, `2026-10-09 10:00-12:00`";

interface Clock {
  hour: number;
  minute: number;
  meridiem: "am" | "pm" | null;
}

function parseClockText(text: string): Clock | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? 0);
  const meridiem = match[3] ? (match[3].startsWith("a") ? "am" : "pm") : null;
  if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 24)) return null;
  return { hour, minute, meridiem };
}

function to24(clock: Clock, meridiem = clock.meridiem): number {
  if (!meridiem) return clock.hour * 60 + clock.minute;
  const hour = (clock.hour % 12) + (meridiem === "pm" ? 12 : 0);
  return hour * 60 + clock.minute;
}

/** Minutes after midnight for one clock time. Bare hours 1–7 are read as afternoon (the lab isn't open at 3 AM). */
function singleMinutes(clock: Clock) {
  if (!clock.meridiem && clock.hour >= 1 && clock.hour <= 7) return to24(clock, "pm");
  return to24(clock);
}

/** "10-4pm", "10:00-18:00", "2pm to 3:30pm" → minutes after midnight [start, end). */
export function parseTimeRange(text: string): { start: number; end: number } | null {
  const parts = text.split(/\s*(?:-|–|—|\bto\b)\s*/);
  if (parts.length !== 2) return null;
  const [a, b] = parts.map(parseClockText);
  if (!a || !b) return null;
  let end = b.meridiem ? to24(b) : singleMinutes(b);
  if (!b.meridiem && b.hour === 24) end = 24 * 60;
  let start: number;
  if (a.meridiem) start = to24(a);
  else if (b.meridiem) {
    // "2-4pm" → 2pm-4pm; "10-4pm" → 10am-4pm.
    const same = to24(a, b.meridiem);
    start = same < end ? same : to24(a, "am");
  } else start = singleMinutes(a);
  if (start >= end) return null;
  return { start, end };
}

function parseDay(text: string, today: LocalDate): LocalDate | null {
  const value = text.trim().replace(/,/g, "");
  if (value === "today") return today;
  if (value === "tomorrow" || value === "tmrw") return addLocalDays(today, 1);

  const weekday = /^(next\s+)?([a-z]{3})[a-z]*$/.exec(value);
  if (weekday && WEEKDAYS.includes(weekday[2])) {
    const target = WEEKDAYS.indexOf(weekday[2]);
    let ahead = (target - weekdayOf(today) + 7) % 7;
    if (weekday[1] && ahead === 0) ahead = 7;
    return addLocalDays(today, ahead);
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) return valid({ year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) });

  const monthFirst = /^([a-z]{3})[a-z]*\.?\s+(\d{1,2})$/.exec(value);
  const dayFirst = /^(\d{1,2})\s+([a-z]{3})[a-z]*$/.exec(value);
  const slash = /^(\d{1,2})\/(\d{1,2})$/.exec(value);
  let month: number | null = null;
  let day: number | null = null;
  if (monthFirst && MONTHS.includes(monthFirst[1])) [month, day] = [MONTHS.indexOf(monthFirst[1]) + 1, Number(monthFirst[2])];
  else if (dayFirst && MONTHS.includes(dayFirst[2])) [month, day] = [MONTHS.indexOf(dayFirst[2]) + 1, Number(dayFirst[1])];
  else if (slash) [month, day] = [Number(slash[1]), Number(slash[2])];
  if (month === null || day === null) return null;
  // No year: the next time that date comes round.
  let candidate = valid({ year: today.year, month, day });
  if (candidate && (candidate.month < today.month || (candidate.month === today.month && candidate.day < today.day))) {
    candidate = valid({ year: today.year + 1, month, day });
  }
  return candidate;
}

function valid(date: LocalDate): LocalDate | null {
  const check = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return check.getUTCMonth() === date.month - 1 && check.getUTCDate() === date.day ? date : null;
}

const atMinutes = (date: LocalDate, minutes: number, timeZone: string) =>
  minutes >= 24 * 60
    ? fromLocal({ ...addLocalDays(date, 1), hour: 0, minute: minutes - 24 * 60 }, timeZone)
    : fromLocal({ ...date, hour: Math.floor(minutes / 60), minute: minutes % 60 }, timeZone);

/** Splits "Oct 9 2pm-4pm" into its day part and the rest, trying the longest day phrase first. */
function splitDay(text: string, today: LocalDate) {
  const words = text.split(/\s+/);
  for (let take = Math.min(3, words.length); take >= 1; take--) {
    const day = parseDay(words.slice(0, take).join(" "), today);
    if (day) return { day, rest: words.slice(take).join(" ") };
  }
  return null;
}

/** A closure range: "<day> [<time>-<time> | all day]". A bare day means all day. */
export function parseWhen(input: string, now: Date, timeZone: string): { start: Date; end: Date; allDay: boolean } {
  const text = input.trim().toLowerCase();
  const today = localDateOf(now, timeZone);
  const split = splitDay(text, today);
  if (!split) throw new WhenParseError(`I couldn't find a day in "${input}". Try ${WHEN_EXAMPLES}.`);
  const rest = split.rest.replace(/^(from|at)\s+/, "").trim();
  if (rest === "" || rest === "all day" || rest === "allday") {
    return { start: atMinutes(split.day, 0, timeZone), end: atMinutes(split.day, 24 * 60, timeZone), allDay: true };
  }
  const range = parseTimeRange(rest);
  if (!range) throw new WhenParseError(`I couldn't read the times in "${input}". Try ${WHEN_EXAMPLES}.`);
  return { start: atMinutes(split.day, range.start, timeZone), end: atMinutes(split.day, range.end, timeZone), allDay: false };
}

/** A single start time: "<day> <time>" or just "<time>" (today). */
export function parseStart(input: string, now: Date, timeZone: string): Date {
  const text = input.trim().toLowerCase();
  const today = localDateOf(now, timeZone);
  const split = splitDay(text, today) ?? { day: today, rest: text };
  const clock = parseClockText(split.rest.replace(/^at\s+/, ""));
  if (!clock) throw new WhenParseError(`I couldn't read "${input}". Try \`Wed 2pm\`, \`tomorrow 10:30\` or \`Oct 9 1pm\`.`);
  return atMinutes(split.day, singleMinutes(clock), timeZone);
}
