import "server-only";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { PRINTQ_TIMEZONE, SLOT_HOLDING_STATUSES, SLOT_STEP_MINUTES, type PrintQSettings } from "./constants";
import { db, schema } from "./db/client";
import { PrintQError } from "./errors";
import type { Interval } from "./scheduling/intervals";
import { availableStarts, labWindows, type Slot, type WeeklyHours } from "./scheduling/slots";

export type Printer = typeof schema.printers.$inferSelect;

export async function getActivePrinter(): Promise<Printer> {
  const [printer] = await db()
    .select()
    .from(schema.printers)
    .where(eq(schema.printers.status, "active"))
    .orderBy(asc(schema.printers.createdAt))
    .limit(1);
  if (!printer) throw new PrintQError("not_found", "No printer is available for booking right now");
  return printer;
}

const rangeLiteral = (range: Interval) => `[${range.start.toISOString()},${range.end.toISOString()})`;

export interface ScheduleData {
  weeklyHours: WeeklyHours[];
  closures: { start: Date; end: Date; kind: "closure" | "maintenance"; reason: string }[];
  bookings: { id: string; ownerId: string; status: (typeof SLOT_HOLDING_STATUSES)[number]; start: Date; end: Date }[];
}

export async function loadScheduleData(printerId: string, range: Interval): Promise<ScheduleData> {
  const database = db();

  const [hours, closureRows, bookingRows] = await Promise.all([
    database
      .select()
      .from(schema.labHours)
      .where(or(isNull(schema.labHours.printerId), eq(schema.labHours.printerId, printerId))),
    database
      .select()
      .from(schema.closures)
      .where(
        and(
          or(isNull(schema.closures.printerId), eq(schema.closures.printerId, printerId)),
          sql`${schema.closures.during} && ${rangeLiteral(range)}::tstzrange`
        )
      ),
    database
      .select({
        id: schema.bookings.id,
        ownerId: schema.bookings.ownerId,
        status: schema.bookings.status,
        slot: schema.bookings.slot,
      })
      .from(schema.bookings)
      .where(
        and(
          eq(schema.bookings.printerId, printerId),
          inArray(schema.bookings.status, [...SLOT_HOLDING_STATUSES]),
          sql`${schema.bookings.slot} && ${rangeLiteral(range)}::tstzrange`
        )
      ),
  ]);

  return {
    weeklyHours: hours.map((row) => ({ weekday: row.weekday, opensAt: row.opensAt, closesAt: row.closesAt })),
    closures: closureRows.map((row) => ({ ...row.during, kind: row.kind, reason: row.reason })),
    bookings: bookingRows.map((row) => ({
      id: row.id,
      ownerId: row.ownerId,
      status: row.status as ScheduleData["bookings"][number]["status"],
      ...row.slot,
    })),
  };
}

export async function findAvailableSlots(params: {
  printerId: string;
  durationMinutes: number;
  range: Interval;
  settings: PrintQSettings;
  now?: Date;
}): Promise<Slot[]> {
  const now = params.now ?? new Date();
  const data = await loadScheduleData(params.printerId, {
    start: params.range.start,
    // Look past the range so prints that run long still see later bookings.
    end: new Date(params.range.end.getTime() + params.durationMinutes * 60_000),
  });
  // Ordinary closures only stop prints from starting; maintenance blocks the printer outright.
  const windows = labWindows(params.range, data.weeklyHours, data.closures, PRINTQ_TIMEZONE);
  const busy = [...data.bookings, ...data.closures.filter((closure) => closure.kind === "maintenance")];
  return availableStarts({
    windows,
    busy,
    durationMinutes: params.durationMinutes,
    stepMinutes: SLOT_STEP_MINUTES,
    earliestStart: new Date(now.getTime() + params.settings.minLeadMinutes * 60_000),
    mustFinishInLabHours: params.settings.mustFinishInLabHours,
  });
}
