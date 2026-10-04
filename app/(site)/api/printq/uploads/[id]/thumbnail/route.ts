import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { disabledResponse } from "~/app/printq/api";
import { db, schema } from "~/app/printq/db/client";
import { diskStore } from "~/app/printq/files";
import { hasRole, requireApiViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", qoi: "image/qoi" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { viewer, error } = await requireApiViewer();
  if (error) return error;

  const { id } = await params;
  const ownerOnly = hasRole(viewer, "staff") ? undefined : eq(schema.uploads.ownerId, viewer.userId);
  const [upload] = await db()
    .select({ thumbnailKey: schema.uploads.thumbnailKey })
    .from(schema.uploads)
    .where(and(eq(schema.uploads.id, id), ownerOnly))
    .limit(1);
  if (!upload?.thumbnailKey) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const extension = upload.thumbnailKey.split(".").pop() ?? "png";
  return new Response(diskStore().stream(upload.thumbnailKey), {
    headers: {
      "Content-Type": CONTENT_TYPES[extension] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
