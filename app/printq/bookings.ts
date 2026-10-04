import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES, SLOT_HOLDING_STATUSES, SLOT_STEP_MINUTES, type BookingStatus } from "./constants";
import { db, schema } from "./db/client";
import { PrintQError, pgErrorCode } from "./errors";
import { diskStore } from "./files";
import { GcodeParseError, parseGcodeFile, printerModelMatches } from "./gcode";
import { findAvailableSlots, getActivePrinter } from "./schedule";
import { bookedDurationMinutes } from "./scheduling/slots";
import { nextStatus, type BookingAction, type BookingActor } from "./scheduling/state-machine";
import { getSettings } from "./settings";
import { hasRole, type Viewer } from "./roles";

export type Booking = typeof schema.bookings.$inferSelect;
export type Upload = typeof schema.uploads.$inferSelect;

// --- Uploads ---

export async function storeUpload(viewer: Viewer, filename: string, body: ReadableStream<Uint8Array>) {
  const extension = ACCEPTED_EXTENSIONS.find((ext) => filename.toLowerCase().endsWith(ext));
  if (!extension) throw new PrintQError("unsupported_file", "Upload a .gcode or .bgcode file sliced in PrusaSlicer");

  const store = diskStore();
  const id = randomUUID();
  const storageKey = `gcode/${id}${extension}`;
  const { sizeBytes, sha256 } = await store.save(storageKey, body, MAX_UPLOAD_BYTES);

  try {
    const parsed = await parseGcodeFile(store.localPath(storageKey));
    let thumbnailKey: string | null = null;
    if (parsed.thumbnail) {
      thumbnailKey = `thumbs/${id}.${parsed.thumbnail.format}`;
      await store.saveBytes(thumbnailKey, parsed.thumbnail.data);
    }
    const [upload] = await db()
      .insert(schema.uploads)
      .values({
        id,
        ownerId: viewer.userId,
        storageKey,
        originalName: filename.slice(0, 200),
        sizeBytes,
        sha256,
        summary: parsed.summary,
        thumbnailKey,
      })
      .returning();
    return upload;
  } catch (error) {
    await store.remove(storageKey);
    if (error instanceof GcodeParseError) throw new PrintQError("unsupported_file", error.message);
    throw error;
  }
}

// --- Creating a booking ---

export interface CreateBookingInput {
  uploadId: string;
  start: Date;
  notes?: string;
  modelUrl?: string;
}

export async function createBooking(viewer: Viewer, input: CreateBookingInput): Promise<Booking> {
  const database = db();
  const [settings, printer] = await Promise.all([getSettings(), getActivePrinter()]);

  const [upload] = await database
    .select()
    .from(schema.uploads)
    .where(and(eq(schema.uploads.id, input.uploadId), eq(schema.uploads.ownerId, viewer.userId)))
    .limit(1);
  if (!upload || upload.purgedAt) throw new PrintQError("not_found", "Upload not found");

  const { printSeconds, printerModel } = upload.summary;
  if (!printSeconds) throw new PrintQError("unsupported_file", "The file has no print time estimate. Re-export it from PrusaSlicer.");
  if (!printerModelMatches(printerModel, printer.model)) {
    throw new PrintQError(
      "wrong_printer",
      `This file was sliced for ${printerModel ?? "an unknown printer"}; ours is a ${printer.model}.`
    );
  }
  if (printSeconds > settings.maxPrintHours * 3600) {
    throw new PrintQError("too_long", `Prints are limited to ${settings.maxPrintHours} hours`);
  }

  const durationMinutes = bookedDurationMinutes(printSeconds, settings, SLOT_STEP_MINUTES);
  const start = input.start;
  const end = new Date(start.getTime() + durationMinutes * 60_000);

  // The requested start must be one the scheduler would offer right now.
  const slots = await findAvailableSlots({
    printerId: printer.id,
    durationMinutes,
    range: { start, end: new Date(start.getTime() + SLOT_STEP_MINUTES * 60_000) },
    settings,
  });
  if (!slots.some((slot) => slot.start.getTime() === start.getTime())) {
    throw new PrintQError("slot_unavailable", "That time is no longer available. Pick another one.");
  }

  try {
    return await database.transaction(async (tx) => {
      // Serialise booking creation per user so the quota check cannot race.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`printq:user:${viewer.userId}`}))`);
      await expireHolds(tx);

      const [{ active }] = await tx
        .select({ active: sql<number>`count(*)::int` })
        .from(schema.bookings)
        .where(and(eq(schema.bookings.ownerId, viewer.userId), inArray(schema.bookings.status, [...SLOT_HOLDING_STATUSES])));
      if (active >= settings.maxActiveBookingsPerUser) {
        throw new PrintQError("quota_exceeded", `You can have at most ${settings.maxActiveBookingsPerUser} active bookings`);
      }

      const [booking] = await tx
        .insert(schema.bookings)
        .values({
          printerId: printer.id,
          ownerId: viewer.userId,
          uploadId: upload.id,
          slot: { start, end },
          status: "pending",
          holdExpiresAt: new Date(Date.now() + settings.holdHours * 3_600_000),
          notes: input.notes?.slice(0, 500) || null,
          modelUrl: input.modelUrl || null,
        })
        .returning();
      await tx.insert(schema.bookingEvents).values({
        bookingId: booking.id,
        actorId: viewer.userId,
        action: "request",
        toStatus: "pending",
      });
      return booking;
    });
  } catch (error) {
    // bookings_no_overlap: someone else took the slot between the check and the insert.
    if (pgErrorCode(error) === "23P01") {
      throw new PrintQError("slot_unavailable", "Someone just booked that time. Pick another one.");
    }
    throw error;
  }
}

// --- Lifecycle ---

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

export async function transitionBooking(
  viewer: Viewer,
  bookingId: string,
  action: BookingAction,
  note?: string
): Promise<Booking> {
  return db().transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(schema.bookings)
      .where(eq(schema.bookings.id, bookingId))
      .for("update")
      .limit(1);
    if (!booking) throw new PrintQError("not_found", "Booking not found");

    const isOwner = booking.ownerId === viewer.userId;
    const actor: BookingActor | null = hasRole(viewer, "staff") ? "staff" : isOwner ? "owner" : null;
    if (!actor) throw new PrintQError("not_found", "Booking not found");

    let to: BookingStatus;
    try {
      to = nextStatus(booking.status, action, actor);
    } catch {
      throw new PrintQError("invalid_transition", `Cannot ${action.replace("_", " ")} a booking that is ${booking.status}`);
    }

    const decision = action === "approve" || action === "reject";
    const [updated] = await tx
      .update(schema.bookings)
      .set({
        status: to,
        updatedAt: new Date(),
        ...(decision ? { decidedBy: viewer.userId, decidedAt: new Date(), decisionReason: note ?? null } : {}),
        ...(to !== "pending" ? { holdExpiresAt: null } : {}),
      })
      .where(eq(schema.bookings.id, bookingId))
      .returning();
    await tx.insert(schema.bookingEvents).values({
      bookingId,
      actorId: viewer.userId,
      action,
      fromStatus: booking.status,
      toStatus: to,
      note: note ?? null,
    });
    return updated;
  });
}

/** Moves pending bookings past their hold to `expired`. Safe to call from any transaction. */
export async function expireHolds(tx: Tx | ReturnType<typeof db> = db(), now = new Date()) {
  const expired = await tx
    .update(schema.bookings)
    .set({ status: "expired", holdExpiresAt: null, updatedAt: now })
    .where(and(eq(schema.bookings.status, "pending"), lt(schema.bookings.holdExpiresAt, now)))
    .returning({ id: schema.bookings.id });
  if (expired.length > 0) {
    await tx.insert(schema.bookingEvents).values(
      expired.map(({ id }) => ({ bookingId: id, action: "expire", fromStatus: "pending" as const, toStatus: "expired" as const }))
    );
  }
  return expired.map(({ id }) => id);
}
