import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import z from "zod";
import { disabledResponse } from "~/app/printq/api";
import { createBooking } from "~/app/printq/bookings";
import { BOOKING_PURPOSES } from "~/app/printq/constants";
import { db, schema } from "~/app/printq/db/client";
import { errorResponse, PrintQError } from "~/app/printq/errors";
import { requireApiViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  uploadId: z.string().uuid(),
  start: z.string().datetime(),
  durationMinutes: z.number().int().positive().optional(),
  title: z.string().trim().max(120).optional(),
  purpose: z.enum(BOOKING_PURPOSES).optional(),
  notes: z.string().max(500).optional(),
  modelUrl: z.string().url().max(500).optional(),
  acceptedRules: z.literal(true),
});

export async function GET() {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { viewer, error } = await requireApiViewer();
  if (error) return error;

  const bookings = await db()
    .select()
    .from(schema.bookings)
    .where(eq(schema.bookings.ownerId, viewer.userId))
    .orderBy(desc(schema.bookings.createdAt))
    .limit(100);
  return NextResponse.json({ bookings });
}

export async function POST(request: Request) {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { viewer, error } = await requireApiViewer();
  if (error) return error;

  try {
    const parsed = createSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new PrintQError("bad_request", "Invalid booking request");
    const booking = await createBooking(viewer, { ...parsed.data, start: new Date(parsed.data.start) });
    // TODO(phase 3): post the approval request to PRINTQ_ADMIN_CHANNEL_ID and DM the member.
    return NextResponse.json({ booking }, { status: 201 });
  } catch (caught) {
    return errorResponse(caught);
  }
}
