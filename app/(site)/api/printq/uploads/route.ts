import { NextResponse } from "next/server";
import { disabledResponse } from "~/app/printq/api";
import { storeUpload } from "~/app/printq/bookings";
import { MAX_UPLOAD_BYTES } from "~/app/printq/constants";
import { errorResponse, PrintQError } from "~/app/printq/errors";
import { requireApiViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

/**
 * Raw-body upload: `fetch("/api/printq/uploads", { method: "POST", body: file,
 * headers: { "x-printq-filename": encodeURIComponent(file.name) } })`.
 * Streams to disk, so nginx must allow it: see deploy/printq/nginx-printq.conf.
 */
export async function POST(request: Request) {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { viewer, error } = await requireApiViewer();
  if (error) return error;

  try {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > MAX_UPLOAD_BYTES) throw new PrintQError("too_large", "Files must be 50 MB or smaller");
    const filename = decodeURIComponent(request.headers.get("x-printq-filename") ?? "");
    if (!filename || !request.body) throw new PrintQError("bad_request", "Missing file");

    const upload = await storeUpload(viewer, filename, request.body);
    return NextResponse.json({
      id: upload.id,
      originalName: upload.originalName,
      sizeBytes: upload.sizeBytes,
      summary: upload.summary,
      thumbnailUrl: upload.thumbnailKey ? `/api/printq/uploads/${upload.id}/thumbnail` : null,
    });
  } catch (caught) {
    return errorResponse(caught);
  }
}
