import { PRINTQ_TIMEZONE, type BookingStatus } from "./constants";

export const STATUS_LABELS: Record<BookingStatus, string> = {
  pending: "Awaiting approval",
  approved: "Confirmed",
  rejected: "Rejected",
  expired: "Hold expired",
  cancelled: "Cancelled",
  checked_in: "Checked in",
  printing: "Printing",
  finished: "Ready for pickup",
  collected: "Collected",
  no_show: "No-show",
  failed: "Print failed",
  lab_closed: "Lab was closed",
};

const dateTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: PRINTQ_TIMEZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const timeOnly = new Intl.DateTimeFormat("en-CA", { timeZone: PRINTQ_TIMEZONE, hour: "numeric", minute: "2-digit" });

export const formatDateTime = (date: Date | string) => dateTime.format(new Date(date));
export const formatTime = (date: Date | string) => timeOnly.format(new Date(date));
export const formatSlot = (start: Date | string, end: Date | string) => `${formatDateTime(start)} → ${formatTime(end)}`;

export function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return hours > 0 ? `${hours} h${rest ? ` ${rest} m` : ""}` : `${rest} m`;
}

export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
