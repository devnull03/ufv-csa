// Serializable calendar model shared by the server (schedule.ts) and the
// browser (WeekCalendar, time picker). Dates are ISO strings.

export type CalendarBlockKind = "booked" | "pending" | "printing" | "maintenance" | "closure" | "mine";

export interface CalendarBlock {
  kind: CalendarBlockKind;
  start: string;
  end: string;
  // Closure reason, or the member's own print title. Never another member's name.
  label?: string;
  // For kind "mine": the booking's status, e.g. pending or approved.
  status?: string;
}

export interface CalendarData {
  timeZone: string;
  rangeStart: string;
  rangeEnd: string;
  now: string;
  // Lab-hours windows in which a print may start (closures already removed).
  windows: { start: string; end: string }[];
  blocks: CalendarBlock[];
}
