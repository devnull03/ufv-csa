import { NextResponse } from "next/server";
import z from "zod";
import { disabledResponse } from "~/app/printq/api";
import { affectedByClosure, createClosure, removeClosure } from "~/app/printq/availability";
import { PRINTQ_TIMEZONE } from "~/app/printq/constants";
import { errorResponse, PrintQError } from "~/app/printq/errors";
import { addLocalDays, fromLocal, parseClock } from "~/app/printq/scheduling/time";
import { requireApiViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

const closureSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  allDay: z.boolean().default(false),
  from: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  to: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  kind: z.enum(["closure", "maintenance"]).default("closure"),
  reason: z.string().trim().min(1).max(120),
  // preview: list affected bookings; notify: close them and DM members; keep: leave them.
  mode: z.enum(["preview", "notify", "keep"]),
});

function rangeOf(input: z.infer<typeof closureSchema>) {
  const [year, month, day] = input.date.split("-").map(Number);
  const date = { year, month, day };
  if (input.allDay) {
    return { start: fromLocal({ ...date, hour: 0, minute: 0 }, PRINTQ_TIMEZONE), end: fromLocal({ ...addLocalDays(date, 1), hour: 0, minute: 0 }, PRINTQ_TIMEZONE) };
  }
  if (!input.from || !input.to) throw new PrintQError("bad_request", "Pick a start and end time, or tick all day");
  const from = parseClock(input.from);
  const to = parseClock(input.to);
  const range = { start: fromLocal({ ...date, ...from }, PRINTQ_TIMEZONE), end: fromLocal({ ...date, ...to }, PRINTQ_TIMEZONE) };
  if (range.end <= range.start) throw new PrintQError("bad_request", "The closure must end after it starts");
  return range;
}

// POST: preview or create a closure (staff). Same rules as /printstaff close in Discord.
export async function POST(request: Request) {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { viewer, error } = await requireApiViewer("staff");
  if (error) return error;
  try {
    const parsed = closureSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new PrintQError("bad_request", "Check the closure details");
    const range = rangeOf(parsed.data);
    if (parsed.data.mode === "preview") return NextResponse.json({ affected: await affectedByClosure(range, parsed.data.kind) });
    const result = await createClosure({ range, kind: parsed.data.kind, reason: parsed.data.reason, actor: viewer, closeAffected: parsed.data.mode === "notify" });
    return NextResponse.json({ closureId: result.closure.id, affected: result.affected.length, changed: result.changed });
  } catch (caught) {
    return errorResponse(caught);
  }
}

// DELETE ?id=…: remove a closure (staff).
export async function DELETE(request: Request) {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { error } = await requireApiViewer("staff");
  if (error) return error;
  try {
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new PrintQError("bad_request", "Unknown closure");
    await removeClosure(id);
    return NextResponse.json({ ok: true });
  } catch (caught) {
    return errorResponse(caught);
  }
}
