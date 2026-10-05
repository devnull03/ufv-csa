import { NextResponse } from "next/server";
import z from "zod";
import { disabledResponse } from "~/app/printq/api";
import { setLabStatus, usesLocalLabStatus } from "~/app/printq/lab-status";
import { requireApiViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

// POST { open: boolean }: staff toggle used when /sccroom (Sanity) isn't connected, e.g. demo mode.
export async function POST(request: Request) {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { viewer, error } = await requireApiViewer("staff");
  if (error) return error;
  if (!usesLocalLabStatus()) {
    return NextResponse.json({ error: "conflict", message: "Lab status comes from /sccroom in Discord" }, { status: 409 });
  }
  const parsed = z.object({ open: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  return NextResponse.json(await setLabStatus(parsed.data.open, viewer.userId));
}
