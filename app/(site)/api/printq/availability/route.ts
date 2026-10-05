import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { disabledResponse } from "~/app/printq/api";
import { bookingLength } from "~/app/printq/bookings";
import { SLOT_STEP_MINUTES } from "~/app/printq/constants";
import { db, schema } from "~/app/printq/db/client";
import { errorResponse, PrintQError } from "~/app/printq/errors";
import { getActivePrinter, loadCalendar } from "~/app/printq/schedule";
import { getSettings } from "~/app/printq/settings";
import { requireApiViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

/**
 * GET /api/printq/availability?uploadId=…
 * Everything the time picker needs to place a print client-side; the server
 * re-validates the chosen start when the booking is created.
 */
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
    const now = new Date();
    const calendar = await loadCalendar(
      printer.id,
      { start: now, end: new Date(now.getTime() + settings.bookingHorizonDays * 86_400_000) },
      viewer.userId
    );
    return NextResponse.json({
      printer: { name: printer.name, model: printer.model },
      length: bookingLength(upload.summary.printSeconds, settings),
      fileMinutes: Math.round(upload.summary.printSeconds / 60),
      stepMinutes: SLOT_STEP_MINUTES,
      earliestStart: new Date(now.getTime() + settings.minLeadMinutes * 60_000).toISOString(),
      mustFinishInLabHours: settings.mustFinishInLabHours,
      calendar,
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}
