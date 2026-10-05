import { NextResponse } from "next/server";
import { disabledResponse } from "~/app/printq/api";
import { isDemoMode } from "~/app/printq/env";
import { runJobs } from "~/app/printq/jobs";
import { requireApiViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

// Demo mode: lets staff run the cron jobs (expiry, reminders, purge) on demand.
export async function POST() {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { error } = await requireApiViewer("staff");
  if (error) return error;
  if (!isDemoMode()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(await runJobs());
}
