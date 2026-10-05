import { PRINTQ_TIMEZONE, type BookingStatus } from "./constants";

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Declined",
  expired: "Hold expired",
  cancelled: "Cancelled",
  checked_in: "Checked in",
  printing: "Printing",
  finished: "Ready for pickup",
  collected: "Completed",
  no_show: "No-show",
  failed: "Print failed",
  lab_closed: "Lab was closed",
};

const tz = { timeZone: PRINTQ_TIMEZONE } as const;
const dateTime = new Intl.DateTimeFormat("en-US", { ...tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const timeOnly = new Intl.DateTimeFormat("en-US", { ...tz, hour: "numeric", minute: "2-digit" });
const dayOnly = new Intl.DateTimeFormat("en-US", { ...tz, weekday: "short", month: "short", day: "numeric" });

// Newer ICU versions put a narrow no-break space before AM/PM.
const plain = (text: string) => text.replace(/[\u202f\u00a0]/g, " ");

/** "Thu, Oct 8, 10:00 AM" */
export const formatDateTime = (date: Date | string) => plain(dateTime.format(new Date(date)));
/** "10:00 AM" */
export const formatTime = (date: Date | string) => plain(timeOnly.format(new Date(date)));
/** "Thu Oct 8" */
export const formatDay = (date: Date | string) => dayOnly.format(new Date(date)).replace(",", "");
/** "Thu Oct 8, 10:00 AM → 12:40 PM" */
export const formatSlot = (start: Date | string, end: Date | string) =>
  `${formatDay(start)}, ${formatTime(start)} → ${formatTime(end)}`;
/** "10:00AM–11:30AM", the compact form used inside calendar blocks */
export const formatCompactRange = (start: Date | string, end: Date | string) =>
  `${formatTime(start).replace(" ", "")}–${formatTime(end).replace(" ", "")}`;

/** "2 h 40 m", "45 m" */
export function formatDuration(minutes: number) {
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return hours > 0 ? `${hours} h${rest ? ` ${rest} m` : ""}` : `${rest} m`;
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "10:00" (Postgres time) → "10:00 AM" */
export function formatClock(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const suffix = hours >= 12 && hours < 24 ? "PM" : "AM";
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}
