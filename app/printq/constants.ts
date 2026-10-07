export const PRINTQ_TIMEZONE = "America/Vancouver";
export const SLOT_STEP_MINUTES = 15;
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = [".gcode", ".bgcode"] as const;

export const BOOKING_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "cancelled",
  "checked_in",
  "printing",
  "finished",
  "collected",
  "no_show",
  "failed",
  "lab_closed",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

// Statuses that hold the printer. Must match the WHERE clause of the
// bookings_no_overlap exclusion constraint in drizzle/0001_booking_exclusion.sql.
export const SLOT_HOLDING_STATUSES = [
  "pending",
  "approved",
  "checked_in",
  "printing",
] as const satisfies readonly BookingStatus[];

export const USER_ROLES = ["member", "staff", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PRINTER_STATUSES = ["active", "maintenance", "retired"] as const;
// As written in `; printer_model = …` by PrusaSlicer (an MK3S+ writes "MK3S").
export const PRINTER_MODELS = ["MK3S", "MK3", "MK2.5S", "MK2.5", "MK2S", "MK3.5", "MK3.9", "MK4", "MK4S", "COREONE"] as const;

export const CLOSURE_KINDS = ["closure", "maintenance"] as const;

export const BOOKING_PURPOSES = ["course", "club", "personal"] as const;
export type BookingPurpose = (typeof BOOKING_PURPOSES)[number];

// Members may adjust the booked length in these steps (DESIGN: "Time to book").
export const MIN_BOOKING_MINUTES = 15;

export interface PrintQSettings {
  paddingPct: number;
  bufferMinutes: number;
  holdHours: number;
  checkinGraceMinutes: number;
  maxActiveBookingsPerUser: number;
  maxPrintHours: number;
  bookingHorizonDays: number;
  minLeadMinutes: number;
  mustFinishInLabHours: boolean;
  fileRetentionDays: number;
  eligibilityRecheckHours: number;
}

export const DEFAULT_SETTINGS: PrintQSettings = {
  paddingPct: 10,
  bufferMinutes: 15,
  holdHours: 48,
  checkinGraceMinutes: 15,
  maxActiveBookingsPerUser: 3,
  maxPrintHours: 24,
  bookingHorizonDays: 14,
  minLeadMinutes: 60,
  mustFinishInLabHours: false,
  fileRetentionDays: 14,
  eligibilityRecheckHours: 24,
};
