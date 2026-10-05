import type { ReactNode } from "react";
import type { BookingStatus } from "../constants";
import type { ParsedGcodeSummary } from "../db/schema";
import { formatDateTime, formatDuration, formatSlot } from "../format";
import { DataPreview, Placeholder } from "./Placeholder";
import { StatusBadge } from "./shared";

// Booking components. DESIGN_BRIEF §5.3.

export function WizardStepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <Placeholder name="WizardStepper" spec="§4.4">
      <ol className="flex flex-wrap gap-4 text-sm">
        {steps.map((step, index) => (
          <li key={step} className={index === current ? "font-bold text-white" : "text-slate-400"}>
            {index + 1}. {step}
          </li>
        ))}
      </ol>
    </Placeholder>
  );
}

export function ThumbnailFrame({ src, alt }: { src: string | null; alt: string }) {
  return (
    <div data-placeholder="ThumbnailFrame" className="flex size-24 items-center justify-center overflow-hidden rounded border border-dashed border-slate-600 bg-slate-950 text-xs text-slate-500">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="size-full object-contain" />
      ) : (
        "No preview"
      )}
    </div>
  );
}

export function GcodeSummaryCard({
  name,
  summary,
  thumbnailUrl,
  durationMinutes,
  printerModel,
  variant = "full",
}: {
  name: string;
  summary: ParsedGcodeSummary;
  thumbnailUrl: string | null;
  durationMinutes?: number;
  printerModel?: string;
  variant?: "full" | "compact";
}) {
  return (
    <Placeholder name={`GcodeSummaryCard (${variant})`} spec="§4.4 step 2">
      <div className="flex gap-4">
        <ThumbnailFrame src={thumbnailUrl} alt={name} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 text-sm">
          <dt>File</dt>
          <dd>{name}</dd>
          <dt>Print time</dt>
          <dd>{summary.printSeconds ? formatDuration(summary.printSeconds / 60) : "Unknown"}</dd>
          {durationMinutes !== undefined && (
            <>
              <dt>Booked for</dt>
              <dd>{formatDuration(durationMinutes)}</dd>
            </>
          )}
          <dt>Filament</dt>
          <dd>
            {summary.filamentGrams ?? "?"} g {summary.filamentType ?? ""}
          </dd>
          <dt>Sliced for</dt>
          <dd>
            {summary.printerModel ?? "Unknown"}
            {printerModel ? ` (our printer: ${printerModel})` : ""}
          </dd>
          <dt>Size</dt>
          <dd>{summary.bbox ? `${summary.bbox.x} × ${summary.bbox.y} × ${summary.bbox.z} mm` : "Unknown"}</dd>
        </dl>
      </div>
    </Placeholder>
  );
}

export interface BookingListItem {
  id: string;
  status: BookingStatus;
  start: Date;
  end: Date;
  title: string;
  decisionReason: string | null;
  fileName: string;
  thumbnailUrl: string | null;
}

export function BookingCard({ booking, actions }: { booking: BookingListItem; actions?: ReactNode }) {
  return (
    <Placeholder name="BookingCard" spec="§4.5">
      <div className="flex items-center gap-4">
        <ThumbnailFrame src={booking.thumbnailUrl} alt={booking.fileName} />
        <div className="flex-1 space-y-1 text-sm">
          <p className="font-semibold">{booking.fileName}</p>
          <p>{formatSlot(booking.start, booking.end)}</p>
          <StatusBadge status={booking.status} />
        </div>
        {actions}
      </div>
    </Placeholder>
  );
}

export function BookingHeader({ booking }: { booking: BookingListItem }) {
  return (
    <Placeholder name="BookingHeader" spec="§4.6">
      <div className="flex items-center gap-4">
        <ThumbnailFrame src={booking.thumbnailUrl} alt={booking.fileName} />
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">{booking.fileName}</h1>
          <p>{formatSlot(booking.start, booking.end)}</p>
          <StatusBadge status={booking.status} />
        </div>
      </div>
    </Placeholder>
  );
}

export function StatusTimeline({
  events,
}: {
  events: { action: string; toStatus: BookingStatus | null; at: Date; note: string | null }[];
}) {
  return (
    <Placeholder name="StatusTimeline" spec="§4.6">
      <ol className="space-y-1 text-sm">
        {events.map((event) => (
          <li key={`${event.action}-${event.at.toISOString()}`}>
            {formatDateTime(event.at)}: {event.action}
            {event.toStatus ? ` → ${event.toStatus}` : ""}
            {event.note ? ` (${event.note})` : ""}
          </li>
        ))}
      </ol>
    </Placeholder>
  );
}

export function BookingSummary({ draft }: { draft: unknown }) {
  return (
    <Placeholder name="BookingSummary" spec="§4.4 step 4">
      <DataPreview value={draft} />
    </Placeholder>
  );
}
