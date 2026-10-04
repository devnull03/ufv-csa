import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { disabledResponse } from "~/app/printq/api";
import { printqEnv } from "~/app/printq/env";
import { runJobs } from "~/app/printq/jobs";

export const dynamic = "force-dynamic";

function authorized(header: string | null) {
  const expected = Buffer.from(`Bearer ${printqEnv().PRINTQ_CRON_SECRET}`);
  const actual = Buffer.from(header ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// Called every 5 minutes by deploy/printq/printq-cron.timer.
export async function POST(request: Request) {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  if (!authorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runJobs());
}
