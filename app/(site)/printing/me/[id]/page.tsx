import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BookingActionButtons } from "~/app/printq/components/BookingActionButtons";
import { formatDateTime, formatDuration, formatSlot } from "~/app/printq/format";
import { getBookingDetail } from "~/app/printq/queries";
import { allowedActions } from "~/app/printq/scheduling/state-machine";
import { StatusTag } from "~/app/printq/ui/StatusTag";
import { hasRole, requireMemberPage } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Booking" };

const ACTION_COPY: Record<string, string> = {
  request: "Requested",
  approve: "Approved",
  reject: "Declined",
  cancel: "Cancelled",
  expire: "Hold expired",
  check_in: "Checked in",
  start: "Print started",
  finish: "Ready for pickup",
  fail: "Print failed",
  collect: "Collected",
  no_show: "Marked as no-show",
  lab_closed: "Lab was closed",
};

// Booking detail: summary rows (spec C12) and the status history.
export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireMemberPage(`/printing/me/${id}`);
  const booking = /^[0-9a-f-]{36}$/.test(id) ? await getBookingDetail(id) : null;
  if (!booking || (booking.ownerId !== viewer.userId && !hasRole(viewer, "staff"))) notFound();

  const minutes = (booking.slot.end.getTime() - booking.slot.start.getTime()) / 60_000;
  const { summary } = booking;
  const rows: [string, string][] = [
    ["Slot", formatSlot(booking.slot.start, booking.slot.end)],
    ["Length", formatDuration(minutes)],
    ["File", booking.fileName],
    ["Filament", summary.filamentGrams ? `${Math.round(summary.filamentGrams)} g ${summary.filamentType ?? ""}`.trim() : "—"],
    ["Purpose", booking.purpose ? booking.purpose[0].toUpperCase() + booking.purpose.slice(1) : "—"],
  ];
  if (booking.notes) rows.push(["Notes", booking.notes]);
  const ownerActions = booking.ownerId === viewer.userId ? allowedActions(booking.status, "owner") : [];

  return (
    <>
      <Link href="/printing/me" className="btn btn-ghost self-start" style={{ paddingLeft: 0 }}>
        <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
        My prints
      </Link>
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto flex flex-col gap-2">
          <span className="pq-overline">PrintQ · Booking</span>
          <h2>{booking.item.title}</h2>
        </div>
        <StatusTag status={booking.status} reason={booking.decisionReason} />
      </div>

      <div className="pq-split">
        <div className="pq-panel flex flex-col">
          {booking.item.thumbnailUrl ? (
            <div className="pq-thumb pq-rule-b" style={{ borderRight: 0, height: 200 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={booking.item.thumbnailUrl} alt={`Preview of ${booking.fileName}`} />
            </div>
          ) : null}
          {rows.map(([label, value]) => (
            <div key={label} className="pq-summary-row">
              <div className="pq-summary-kv">
                <span className="pq-label" style={{ fontSize: 12 }}>
                  {label}
                </span>
                <span className="pq-value pq-truncate">{value}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-5">
          {booking.status === "pending" && booking.holdExpiresAt ? (
            <p className="pq-soft">
              Your slot is held until <strong className="font-medium">{formatDateTime(booking.holdExpiresAt)}</strong> while staff review it.
            </p>
          ) : null}
          {booking.decisionReason ? (
            <div className="pq-panel flex flex-col gap-1 p-4">
              <span className="pq-label">Note from staff</span>
              <span>{booking.decisionReason}</span>
            </div>
          ) : null}
          <div className="flex flex-col gap-3">
            <h6>History</h6>
            <ol className="pq-rule-t flex flex-col" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {booking.events.map((event) => (
                <li
                  key={`${event.action}-${event.at.toISOString()}`}
                  className="grid gap-4 py-2 text-sm"
                  style={{ gridTemplateColumns: "minmax(0, 1fr) auto", borderBottom: "1px solid var(--color-hairline-soft)" }}
                >
                  <span>
                    {ACTION_COPY[event.action] ?? event.action}
                    {event.note ? <span className="pq-muted"> · {event.note}</span> : null}
                  </span>
                  <span className="pq-muted pq-num">{formatDateTime(event.at)}</span>
                </li>
              ))}
            </ol>
          </div>
          {ownerActions.length > 0 ? <BookingActionButtons bookingId={booking.id} actions={ownerActions} appearance="pq" /> : null}
        </div>
      </div>
    </>
  );
}
