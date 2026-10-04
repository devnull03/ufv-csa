import { BookingActionButtons } from "~/app/printq/components/BookingActionButtons";
import { BookingCard } from "~/app/printq/components/booking";
import { Placeholder } from "~/app/printq/components/Placeholder";
import { DiscordUserChip, EmptyState, PrintQHeader } from "~/app/printq/components/shared";
import { listBookingsForStaff } from "~/app/printq/queries";
import { allowedActions } from "~/app/printq/scheduling/state-machine";

export const dynamic = "force-dynamic";
export const metadata = { title: "Session" };

// DESIGN_BRIEF §4.9: tablet-friendly, big tap targets in the real design.
export default async function SessionPage() {
  const today = await listBookingsForStaff({
    today: true,
    statuses: ["approved", "checked_in", "printing", "finished"],
  });
  return (
    <>
      <PrintQHeader title="Today's session" />
      {today.length === 0 ? (
        <EmptyState title="No sessions today" />
      ) : (
        today.map((booking) => (
          <Placeholder key={booking.id} name="SessionCard" spec="§4.9" className="space-y-2">
            <DiscordUserChip name={booking.ownerName} username={booking.ownerUsername} image={booking.ownerImage} />
            <BookingCard booking={booking.item} />
            <BookingActionButtons
              bookingId={booking.id}
              actions={allowedActions(booking.status, "staff").filter((action) => action !== "cancel")}
            />
          </Placeholder>
        ))
      )}
    </>
  );
}
