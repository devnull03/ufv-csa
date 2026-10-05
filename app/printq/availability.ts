import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, like, lt, sql } from "drizzle-orm";
import { PRINTQ_TIMEZONE } from "./constants";
import { transitionBooking, type Booking } from "./bookings";
import { db, schema } from "./db/client";
import type { TimeRange } from "./db/schema";
import { PrintQError } from "./errors";
import { onAvailabilityChanged, onBookingTransition } from "./notify";
import type { Viewer } from "./roles";
import { parseTimeRange, parseWhen, WhenParseError } from "./scheduling/when";

// Closures, lab hours and the confirmation drafts used by the Discord bot and
// the staff pages. Every change refreshes the Discord boards.

export type ClosureKind = "closure" | "maintenance";

export interface AffectedBooking {
  id: string;
  title: string | null;
  status: Booking["status"];
  slot: TimeRange;
  ownerName: string;
  ownerUsername: string | null;
}

/** Parses a staff-typed range, turning parse errors into user-facing ones. */
export function parseClosureRange(text: string, now = new Date()) {
  try {
    return parseWhen(text, now, PRINTQ_TIMEZONE);
  } catch (error) {
    if (error instanceof WhenParseError) throw new PrintQError("bad_request", error.message);
    throw error;
  }
}

const rangeLiteral = (range: TimeRange) => `[${range.start.toISOString()},${range.end.toISOString()})`;

/**
 * Bookings a new closure would hit. An ordinary closure only stops prints
 * from starting (so: bookings that start inside it); maintenance takes the
 * printer offline (so: any overlap).
 */
export async function affectedByClosure(range: TimeRange, kind: ClosureKind): Promise<AffectedBooking[]> {
  const overlap =
    kind === "maintenance"
      ? sql`${schema.bookings.slot} && ${rangeLiteral(range)}::tstzrange`
      : sql`${rangeLiteral(range)}::tstzrange @> lower(${schema.bookings.slot})`;
  const rows = await db()
    .select({
      id: schema.bookings.id,
      title: schema.bookings.title,
      status: schema.bookings.status,
      slot: schema.bookings.slot,
      ownerName: schema.user.name,
      ownerUsername: schema.profiles.discordUsername,
    })
    .from(schema.bookings)
    .innerJoin(schema.user, eq(schema.user.id, schema.bookings.ownerId))
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.bookings.ownerId))
    .where(and(inArray(schema.bookings.status, ["pending", "approved"]), overlap))
    .orderBy(asc(sql`lower(${schema.bookings.slot})`));
  return rows;
}

export async function createClosure(input: {
  range: TimeRange;
  kind: ClosureKind;
  reason: string;
  actor: Viewer;
  /** Mark affected approved bookings "lab closed" and decline affected requests. */
  closeAffected: boolean;
}) {
  if (input.range.end <= input.range.start) throw new PrintQError("bad_request", "The closure must end after it starts");
  const reason = input.reason.trim().slice(0, 120);
  if (!reason) throw new PrintQError("bad_request", "Give the closure a reason");
  const affected = await affectedByClosure(input.range, input.kind);
  const [closure] = await db()
    .insert(schema.closures)
    .values({ kind: input.kind, during: input.range, reason, createdBy: input.actor.userId })
    .returning();

  const changed: { booking: Booking; action: "lab_closed" | "reject" }[] = [];
  if (input.closeAffected) {
    for (const booking of affected) {
      const action = booking.status === "approved" ? "lab_closed" : "reject";
      try {
        changed.push({ booking: await transitionBooking(input.actor, booking.id, action, reason), action });
      } catch (error) {
        // Someone else changed it meanwhile; leave it.
        if (!(error instanceof PrintQError)) throw error;
      }
    }
  }
  for (const { booking, action } of changed) {
    await onBookingTransition(booking, action, input.actor.userId, action === "reject" ? `Lab closed: ${reason}` : reason);
  }
  await onAvailabilityChanged();
  return { closure, affected, changed: changed.length };
}

export async function removeClosure(id: string) {
  const [removed] = await db().delete(schema.closures).where(eq(schema.closures.id, id)).returning();
  if (!removed) throw new PrintQError("not_found", "That closure no longer exists");
  await onAvailabilityChanged();
  return removed;
}

export async function listUpcomingClosures(limit = 25) {
  return db()
    .select()
    .from(schema.closures)
    .where(sql`upper(${schema.closures.during}) > now()`)
    .orderBy(sql`lower(${schema.closures.during})`)
    .limit(limit);
}

export async function listLabHours() {
  return db()
    .select()
    .from(schema.labHours)
    .where(isNull(schema.labHours.printerId))
    .orderBy(asc(schema.labHours.weekday), asc(schema.labHours.opensAt));
}

const clock = (minutes: number) =>
  minutes >= 24 * 60 ? "24:00" : `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Parses "10:00-18:00", "10am-6pm", "10-12, 1-5" or "closed" into lab-hour ranges. */
export function parseLabHours(text: string): { opensAt: string; closesAt: string }[] {
  const value = text.trim().toLowerCase();
  if (value === "closed" || value === "none" || value === "") return [];
  const ranges = value.split(/\s*[,;]\s*/).map((part) => {
    const range = parseTimeRange(part);
    if (!range) throw new PrintQError("bad_request", `I couldn't read "${part}". Use e.g. \`10:00-18:00\`, \`10am-6pm\` or \`closed\`.`);
    return range;
  });
  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start < ranges[i - 1].end) throw new PrintQError("bad_request", "Those hours overlap");
  }
  return ranges.map((range) => ({ opensAt: clock(range.start), closesAt: clock(range.end) }));
}

/** Replaces one weekday's lab hours (0 = Sunday). */
export async function setLabHours(weekday: number, text: string) {
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw new PrintQError("bad_request", "Unknown weekday");
  const ranges = parseLabHours(text);
  await db().transaction(async (tx) => {
    await tx.delete(schema.labHours).where(and(eq(schema.labHours.weekday, weekday), isNull(schema.labHours.printerId)));
    if (ranges.length) await tx.insert(schema.labHours).values(ranges.map((range) => ({ weekday, ...range })));
  });
  await onAvailabilityChanged();
  return ranges;
}

// --- Drafts: a closure waiting for the staff member to confirm it in Discord ---

export interface ClosureDraft {
  start: string;
  end: string;
  kind: ClosureKind;
  reason: string;
  by: string;
}

const DRAFT_PREFIX = "draft:closure:";

export async function saveClosureDraft(draft: ClosureDraft) {
  const id = randomUUID().slice(0, 12);
  await db().insert(schema.settings).values({ key: `${DRAFT_PREFIX}${id}`, value: draft });
  return id;
}

/** Reads and deletes a draft, so a confirmation button only works once. */
export async function takeClosureDraft(id: string): Promise<ClosureDraft | null> {
  const [row] = await db().delete(schema.settings).where(eq(schema.settings.key, `${DRAFT_PREFIX}${id}`)).returning();
  return (row?.value as ClosureDraft | undefined) ?? null;
}

export async function purgeOldDrafts(now = new Date()) {
  await db()
    .delete(schema.settings)
    .where(and(like(schema.settings.key, `${DRAFT_PREFIX}%`), lt(schema.settings.updatedAt, new Date(now.getTime() - 86_400_000))));
}
