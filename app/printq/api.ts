import "server-only";
import { NextResponse } from "next/server";
import { isPrintQEnabled } from "./env";

// Every PrintQ route 404s until NEXT_PUBLIC_PRINTQ_ENABLED=true.
export function disabledResponse(): NextResponse | null {
  return isPrintQEnabled() ? null : NextResponse.json({ error: "not_found" }, { status: 404 });
}
