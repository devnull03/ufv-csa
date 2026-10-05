import "server-only";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { BookingStatus } from "./constants";
import { db, schema } from "./db/client";
import type { BookingListItem } from "./components/booking";
import { PRINTQ_TIMEZONE } from "./constants";
import { fromLocal, localDateOf, addLocalDays } from "./scheduling/time";

const thumbnailUrl = (uploadId: string, thumbnailKey: string | null) =>
  thumbnailKey ? `/api/printq/uploads/${uploadId}/thumbnail` : null;

const bookingColumns = {
  id: schema.bookings.id,
  status: schema.bookings.status,
  title: schema.bookings.title,
  decisionReason: schema.bookings.decisionReason,
  slot: schema.bookings.slot,
  uploadId: schema.uploads.id,
  fileName: schema.uploads.originalName,
  thumbnailKey: schema.uploads.thumbnailKey,
};

type BookingRow = {
  id: string;
  status: BookingStatus;
  title: string | null;
  decisionReason: string | null;
  slot: { start: Date; end: Date };
  uploadId: string;
  fileName: string;
  thumbnailKey: string | null;
};

const toListItem = (row: BookingRow): BookingListItem => ({
  id: row.id,
  status: row.status,
  start: row.slot.start,
  end: row.slot.end,
  title: row.title ?? row.fileName,
  decisionReason: row.decisionReason,
  fileName: row.fileName,
  thumbnailUrl: thumbnailUrl(row.uploadId, row.thumbnailKey),
});

export async function listMyBookings(userId: string) {
  const rows = await db()
    .select(bookingColumns)
    .from(schema.bookings)
    .innerJoin(schema.uploads, eq(schema.uploads.id, schema.bookings.uploadId))
    .where(eq(schema.bookings.ownerId, userId))
    .orderBy(desc(sql`lower(${schema.bookings.slot})`))
    .limit(100);
  return rows.map(toListItem);
}

export async function getBookingDetail(bookingId: string) {
  const database = db();
  const [row] = await database
    .select({
      ...bookingColumns,
      ownerId: schema.bookings.ownerId,
      notes: schema.bookings.notes,
      purpose: schema.bookings.purpose,
      holdExpiresAt: schema.bookings.holdExpiresAt,
      summary: schema.uploads.summary,
    })
    .from(schema.bookings)
    .innerJoin(schema.uploads, eq(schema.uploads.id, schema.bookings.uploadId))
    .where(eq(schema.bookings.id, bookingId))
    .limit(1);
  if (!row) return null;
  const events = await database
    .select({
      action: schema.bookingEvents.action,
      toStatus: schema.bookingEvents.toStatus,
      at: schema.bookingEvents.at,
      note: schema.bookingEvents.note,
    })
    .from(schema.bookingEvents)
    .where(eq(schema.bookingEvents.bookingId, bookingId))
    .orderBy(asc(schema.bookingEvents.at));
  return { ...row, item: toListItem(row), events };
}

/** Staff views: bookings with the requester's Discord identity. */
export async function listBookingsForStaff(filter: { statuses?: BookingStatus[]; today?: boolean }) {
  const conditions = [];
  if (filter.statuses) conditions.push(inArray(schema.bookings.status, filter.statuses));
  if (filter.today) {
    const today = localDateOf(new Date(), PRINTQ_TIMEZONE);
    const start = fromLocal({ ...today, hour: 0, minute: 0 }, PRINTQ_TIMEZONE);
    const end = fromLocal({ ...addLocalDays(today, 1), hour: 0, minute: 0 }, PRINTQ_TIMEZONE);
    conditions.push(sql`${schema.bookings.slot} && tstzrange(${start.toISOString()}, ${end.toISOString()})`);
  }
  const rows = await db()
    .select({
      ...bookingColumns,
      holdExpiresAt: schema.bookings.holdExpiresAt,
      notes: schema.bookings.notes,
      summary: schema.uploads.summary,
      ownerName: schema.user.name,
      ownerImage: schema.user.image,
      ownerUsername: schema.profiles.discordUsername,
    })
    .from(schema.bookings)
    .innerJoin(schema.uploads, eq(schema.uploads.id, schema.bookings.uploadId))
    .innerJoin(schema.user, eq(schema.user.id, schema.bookings.ownerId))
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.bookings.ownerId))
    .where(and(...conditions))
    .orderBy(asc(sql`lower(${schema.bookings.slot})`))
    .limit(200);
  return rows.map((row) => ({ ...row, item: toListItem(row) }));
}

export async function countPending() {
  const [{ value }] = await db()
    .select({ value: count() })
    .from(schema.bookings)
    .where(eq(schema.bookings.status, "pending"));
  return value;
}
