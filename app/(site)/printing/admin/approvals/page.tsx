import { BookingActionButtons } from "~/app/printq/components/BookingActionButtons";
import { GcodeSummaryCard } from "~/app/printq/components/booking";
import { Placeholder } from "~/app/printq/components/Placeholder";
import { DiscordUserChip, EmptyState, HoldCountdown, PrintQHeader } from "~/app/printq/components/shared";
import { formatSlot } from "~/app/printq/format";
import { listBookingsForStaff } from "~/app/printq/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Approvals" };

// DESIGN_BRIEF §4.8
export default async function ApprovalsPage() {
  const pending = await listBookingsForStaff({ statuses: ["pending"] });
  return (
    <>
      <PrintQHeader title="Approvals" description="Oldest first. Holds expire automatically." />
      {pending.length === 0 ? (
        <EmptyState title="All caught up" />
      ) : (
        pending.map((booking) => (
          <Placeholder key={booking.id} name="ApprovalCard" spec="§4.8" className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <DiscordUserChip name={booking.ownerName} username={booking.ownerUsername} image={booking.ownerImage} />
              {booking.holdExpiresAt && <HoldCountdown expiresAt={booking.holdExpiresAt} />}
            </div>
            <p className="font-semibold">{formatSlot(booking.slot.start, booking.slot.end)}</p>
            <GcodeSummaryCard
              variant="compact"
              name={booking.fileName}
              summary={booking.summary}
              thumbnailUrl={booking.item.thumbnailUrl}
            />
            {booking.notes && <p className="text-sm">Notes: {booking.notes}</p>}
            <BookingActionButtons bookingId={booking.id} actions={["approve", "reject"]} />
          </Placeholder>
        ))
      )}
    </>
  );
}
