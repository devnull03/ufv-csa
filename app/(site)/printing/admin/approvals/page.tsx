import { BookingActionButtons } from "~/app/printq/components/BookingActionButtons";
import { formatDateTime, formatDuration, formatSlot } from "~/app/printq/format";
import { listBookingsForStaff } from "~/app/printq/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals" };

// Approval queue: oldest first. Holds expire automatically.
export default async function ApprovalsPage() {
  const pending = await listBookingsForStaff({ statuses: ["pending"] });
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="pq-overline">PrintQ · Staff</span>
        <h2>Approvals</h2>
        <p className="pq-soft">Oldest first. Unreviewed requests expire when their hold runs out.</p>
      </div>
      {pending.length === 0 ? (
        <div className="pq-panel pq-soft p-6">All caught up.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {pending.map((booking) => {
            const minutes = (booking.slot.end.getTime() - booking.slot.start.getTime()) / 60_000;
            return (
              <article key={booking.id} className="pq-panel grid gap-4 p-4" data-booking={booking.id} style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}>
                <div className="pq-thumb" style={{ border: "1px solid var(--color-divider)", height: 120, minHeight: 0 }}>
                  {booking.item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={booking.item.thumbnailUrl} alt="" />
                  ) : (
                    <span className="pq-muted text-xs">No preview</span>
                  )}
                </div>
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h3 className="mr-auto" style={{ fontSize: 24 }}>
                      {booking.item.title}
                    </h3>
                    {booking.holdExpiresAt ? <span className="pq-muted text-[13px]">Hold expires {formatDateTime(booking.holdExpiresAt)}</span> : null}
                  </div>
                  <span className="pq-soft pq-num">
                    {formatSlot(booking.slot.start, booking.slot.end)} · {formatDuration(minutes)} · {booking.summary.filamentGrams ?? "?"} g{" "}
                    {booking.summary.filamentType ?? ""}
                  </span>
                  <span className="pq-muted text-[13px]">
                    {booking.ownerUsername ? `@${booking.ownerUsername}` : booking.ownerName} · {booking.fileName} · sliced for {booking.summary.printerModel ?? "?"}
                  </span>
                  {booking.notes ? <span className="text-sm">Notes: {booking.notes}</span> : null}
                  <BookingActionButtons bookingId={booking.id} actions={["approve", "reject"]} appearance="pq" />
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
