import { NextResponse } from "next/server";
import z from "zod";
import { disabledResponse } from "~/app/printq/api";
import { transitionBooking } from "~/app/printq/bookings";
import { errorResponse, PrintQError } from "~/app/printq/errors";
import { BOOKING_ACTIONS, type BookingAction } from "~/app/printq/scheduling/state-machine";
import { requireApiViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  action: z.enum(Object.keys(BOOKING_ACTIONS) as [BookingAction, ...BookingAction[]]),
  note: z.string().max(500).optional(),
});

// PATCH { action: "approve" | "reject" | "cancel" | "check_in" | … , note? }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { viewer, error } = await requireApiViewer();
  if (error) return error;

  try {
    const parsed = patchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || parsed.data.action === "expire") throw new PrintQError("bad_request", "Invalid action");
    const { id } = await params;
    const booking = await transitionBooking(viewer, id, parsed.data.action, parsed.data.note);
    // TODO(phase 3): notify the member on Discord.
    return NextResponse.json({ booking });
  } catch (caught) {
    return errorResponse(caught);
  }
}
