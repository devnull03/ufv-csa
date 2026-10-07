import { asc, eq, ne } from "drizzle-orm";
import { NextResponse } from "next/server";
import z from "zod";
import { disabledResponse } from "~/app/printq/api";
import { db, schema } from "~/app/printq/db/client";
import { onAvailabilityChanged } from "~/app/printq/notify";
import { printerSpec } from "~/app/printq/printers";
import { requireApiViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

// PUT { model: "MK3S" | "MK3" | "MK2.5S" | … } (admins): which i3 variant the lab's printer is.
// Sets the name, model and build volume from PrusaSlicer's profile for that variant.
export async function PUT(request: Request) {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { error } = await requireApiViewer("admin");
  if (error) return error;
  const parsed = z.object({ model: z.string().max(20) }).safeParse(await request.json().catch(() => null));
  const spec = parsed.success ? printerSpec(parsed.data.model) : null;
  if (!spec) return NextResponse.json({ error: "bad_request", message: "Unknown printer model" }, { status: 400 });
  const database = db();
  const [printer] = await database.select().from(schema.printers).where(ne(schema.printers.status, "retired")).orderBy(asc(schema.printers.createdAt)).limit(1);
  const values = { name: spec.name, model: spec.model, bedX: spec.bed.x, bedY: spec.bed.y, bedZ: spec.bed.z };
  const [saved] = printer
    ? await database.update(schema.printers).set(values).where(eq(schema.printers.id, printer.id)).returning()
    : await database.insert(schema.printers).values(values).returning();
  await onAvailabilityChanged(); // the Discord boards show the printer's name
  return NextResponse.json({ printer: saved });
}
