import { NextResponse } from "next/server";
import { disabledResponse } from "~/app/printq/api";
import { errorResponse, PrintQError } from "~/app/printq/errors";
import { getActivePrinter, loadCalendar } from "~/app/printq/schedule";

export const dynamic = "force-dynamic";

const MAX_RANGE_MS = 31 * 86_400_000;

// Public: lab-hours windows and anonymous busy blocks. Never includes who booked what.
export async function GET(request: Request) {
  const disabled = disabledResponse();
  if (disabled) return disabled;

  try {
    const params = new URL(request.url).searchParams;
    const start = new Date(params.get("from") ?? Date.now());
    const end = new Date(params.get("to") ?? start.getTime() + 7 * 86_400_000);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start || end.getTime() - start.getTime() > MAX_RANGE_MS) {
      throw new PrintQError("bad_request", "Invalid range");
    }
    const printer = await getActivePrinter();
    const calendar = await loadCalendar(printer.id, { start, end });
    return NextResponse.json({ printer: { id: printer.id, name: printer.name, model: printer.model }, calendar });
  } catch (caught) {
    return errorResponse(caught);
  }
}
