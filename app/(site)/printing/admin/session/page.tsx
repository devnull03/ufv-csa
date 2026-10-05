import { BookingActionButtons } from "~/app/printq/components/BookingActionButtons";
import { formatSlot } from "~/app/printq/format";
import { listBookingsForStaff } from "~/app/printq/queries";
import { allowedActions } from "~/app/printq/scheduling/state-machine";
import { StatusTag } from "~/app/printq/ui/StatusTag";

export const dynamic = "force-dynamic";
export const metadata = { title: "Session" };

// Today's session: big buttons for check-in → printing → finished → collected.
export default async function SessionPage() {
  const today = await listBookingsForStaff({ today: true, statuses: ["approved", "checked_in", "printing", "finished"] });
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="pq-overline">PrintQ · Staff</span>
        <h2>Today&apos;s session</h2>
      </div>
      {today.length === 0 ? (
        <div className="pq-panel pq-soft p-6">No sessions today.</div>
      ) : (
        <div className="flex flex-col gap-4">
          {today.map((booking) => (
            <article key={booking.id} className="pq-panel flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-baseline gap-3">
                <h3 className="mr-auto" style={{ fontSize: 24 }}>
                  {booking.item.title}
                </h3>
                <StatusTag status={booking.status} />
              </div>
              <span className="pq-soft pq-num">
                {formatSlot(booking.slot.start, booking.slot.end)} · {booking.ownerUsername ? `@${booking.ownerUsername}` : booking.ownerName}
              </span>
              <BookingActionButtons
                bookingId={booking.id}
                actions={allowedActions(booking.status, "staff").filter((action) => action !== "cancel")}
                appearance="pq"
              />
            </article>
          ))}
        </div>
      )}
    </>
  );
}
