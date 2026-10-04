import { StatTile } from "~/app/printq/components/admin";
import { BookingCard } from "~/app/printq/components/booking";
import { Placeholder } from "~/app/printq/components/Placeholder";
import { EmptyState, LabStatusBadge, PrintQHeader } from "~/app/printq/components/shared";
import { getLabStatus } from "~/app/printq/lab-status";
import { countPending, listBookingsForStaff } from "~/app/printq/queries";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin" };

// DESIGN_BRIEF §4.7
export default async function AdminDashboardPage() {
  const [pending, today, labStatus] = await Promise.all([countPending(), listBookingsForStaff({ today: true }), getLabStatus()]);
  const printing = today.filter((booking) => booking.status === "printing");

  return (
    <>
      <PrintQHeader
        title="Dashboard"
        description="Toggle lab status with /sccroom in Discord."
        actions={<LabStatusBadge open={labStatus.open} since={labStatus.since} />}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Pending approvals" value={pending} />
        <StatTile label="Today's prints" value={today.length} />
        <StatTile label="Printing now" value={printing.length} />
        <StatTile label="No-shows this week" value="–" hint="TODO" />
      </div>
      <Placeholder name="TodayAgenda" spec="§4.7">
        {today.length === 0 ? (
          <EmptyState title="Nothing booked today" />
        ) : (
          today.map((booking) => <BookingCard key={booking.id} booking={booking.item} />)
        )}
      </Placeholder>
    </>
  );
}
