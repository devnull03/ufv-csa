import { notFound } from "next/navigation";
import { BookingActionButtons } from "~/app/printq/components/BookingActionButtons";
import { BookingHeader, GcodeSummaryCard, StatusTimeline } from "~/app/printq/components/booking";
import { Callout, HoldCountdown } from "~/app/printq/components/shared";
import { getBookingDetail } from "~/app/printq/queries";
import { allowedActions } from "~/app/printq/scheduling/state-machine";
import { hasRole, requireMemberPage } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Booking" };

// DESIGN_BRIEF §4.6
export default async function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await requireMemberPage(`/printing/me/${id}`);
  const booking = /^[0-9a-f-]{36}$/.test(id) ? await getBookingDetail(id) : null;
  if (!booking || (booking.ownerId !== viewer.userId && !hasRole(viewer, "staff"))) notFound();

  return (
    <>
      <BookingHeader booking={booking.item} />
      {booking.status === "pending" && booking.holdExpiresAt && <HoldCountdown expiresAt={booking.holdExpiresAt} />}
      {booking.decisionReason && (
        <Callout tone={booking.status === "rejected" ? "danger" : "info"} title="Note from the admins">
          {booking.decisionReason}
        </Callout>
      )}
      <GcodeSummaryCard
        variant="compact"
        name={booking.fileName}
        summary={booking.summary}
        thumbnailUrl={booking.item.thumbnailUrl}
      />
      <StatusTimeline events={booking.events} />
      {booking.ownerId === viewer.userId && (
        <BookingActionButtons bookingId={booking.id} actions={allowedActions(booking.status, "owner")} />
      )}
    </>
  );
}
