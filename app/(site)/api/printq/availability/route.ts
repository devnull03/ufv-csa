import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { disabledResponse } from "~/app/printq/api";
import { SLOT_STEP_MINUTES } from "~/app/printq/constants";
import { db, schema } from "~/app/printq/db/client";
import { errorResponse, PrintQError } from "~/app/printq/errors";
import { findAvailableSlots, getActivePrinter } from "~/app/printq/schedule";
import { bookedDurationMinutes } from "~/app/printq/scheduling/slots";
import { getSettings } from "~/app/printq/settings";
import { requireApiViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

// GET /api/printq/availability?uploadId=…  →  bookable starts over the booking horizon
export async function GET(request: Request) {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { viewer, error } = await requireApiViewer();
  if (error) return error;

  try {
    const uploadId = new URL(request.url).searchParams.get("uploadId");
    if (!uploadId) throw new PrintQError("bad_request", "uploadId is required");
    const [upload] = await db()
      .select({ summary: schema.uploads.summary })
      .from(schema.uploads)
      .where(and(eq(schema.uploads.id, uploadId), eq(schema.uploads.ownerId, viewer.userId)))
      .limit(1);
    if (!upload?.summary.printSeconds) throw new PrintQError("not_found", "Upload not found");

    const [settings, printer] = await Promise.all([getSettings(), getActivePrinter()]);
    const durationMinutes = bookedDurationMinutes(upload.summary.printSeconds, settings, SLOT_STEP_MINUTES);
    const now = new Date();
    const slots = await findAvailableSlots({
      printerId: printer.id,
      durationMinutes,
      range: { start: now, end: new Date(now.getTime() + settings.bookingHorizonDays * 86_400_000) },
      settings,
      now,
    });
    return NextResponse.json({ durationMinutes, slots });
  } catch (caught) {
    return errorResponse(caught);
  }
}
