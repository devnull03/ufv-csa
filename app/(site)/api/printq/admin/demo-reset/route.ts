import { NextResponse } from "next/server";
import postgres from "postgres";
import { disabledResponse } from "~/app/printq/api";
import { syncBoards } from "~/app/printq/discord/sync";
import { isDemoMode, printqEnv } from "~/app/printq/env";
import { seedDemoData } from "~/app/printq/setup/seed";
import { requireApiViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

// Demo mode: wipe bookings, closures and lab hours and load fresh demo data (staff).
export async function POST() {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { error } = await requireApiViewer("staff");
  if (error) return error;
  if (!isDemoMode()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const sql = postgres(printqEnv().DATABASE_URL, { max: 1, onnotice: () => undefined });
  try {
    await seedDemoData(sql, { reset: true, log: () => undefined });
  } finally {
    await sql.end();
  }
  await syncBoards();
  return NextResponse.json({ ok: true });
}
