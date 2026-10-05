import { NextResponse } from "next/server";
import z from "zod";
import { disabledResponse } from "~/app/printq/api";
import { setLabHours } from "~/app/printq/availability";
import { errorResponse, PrintQError } from "~/app/printq/errors";
import { requireApiViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

// PUT { weekday: 0-6, hours: "10:00-18:00" | "10am-12, 1-5pm" | "closed" } (admins).
export async function PUT(request: Request) {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { error } = await requireApiViewer("admin");
  if (error) return error;
  try {
    const parsed = z.object({ weekday: z.number().int().min(0).max(6), hours: z.string().max(60) }).safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new PrintQError("bad_request", "Invalid lab hours");
    return NextResponse.json({ hours: await setLabHours(parsed.data.weekday, parsed.data.hours) });
  } catch (caught) {
    return errorResponse(caught);
  }
}
