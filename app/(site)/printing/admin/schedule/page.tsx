import { Placeholder } from "~/app/printq/components/Placeholder";
import { EmptyState, PrintQHeader } from "~/app/printq/components/shared";
import { WeekSchedule } from "~/app/printq/components/schedule";
import { PRINTQ_TIMEZONE } from "~/app/printq/constants";
import { getActivePrinter, loadScheduleData } from "~/app/printq/schedule";
import { addLocalDays, fromLocal, localDateOf } from "~/app/printq/scheduling/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule" };

// DESIGN_BRIEF §4.10
export default async function ScheduleManagerPage() {
  const printer = await getActivePrinter().catch(() => null);
  if (!printer) return <EmptyState title="No active printer" body="Add one under Settings → Printers." />;

  const today = localDateOf(new Date(), PRINTQ_TIMEZONE);
  const start = fromLocal({ ...today, hour: 0, minute: 0 }, PRINTQ_TIMEZONE);
  const end = fromLocal({ ...addLocalDays(today, 14), hour: 0, minute: 0 }, PRINTQ_TIMEZONE);
  const data = await loadScheduleData(printer.id, { start, end });

  return (
    <>
      <PrintQHeader title="Schedule" description="Next 14 days" />
      <WeekSchedule
        mode="admin"
        weekStart={start}
        weeklyHours={data.weeklyHours}
        blocks={[
          ...data.bookings.map((booking) => ({
            kind: booking.status === "pending" ? ("pending" as const) : ("booking" as const),
            label: `${booking.status} · ${booking.id.slice(0, 8)}`,
            start: booking.start,
            end: booking.end,
            bookingId: booking.id,
          })),
          ...data.closures.map((closure) => ({ kind: closure.kind, label: closure.reason, start: closure.start, end: closure.end })),
        ]}
      />
      <Placeholder name="BookingDrawer" spec="§4.10">
        Click a block to open booking details and actions in a side sheet.
      </Placeholder>
      <Placeholder name="ClosureForm" spec="§4.10">
        Create a closure or maintenance block, preview the affected bookings, and notify their members. TODO: server action.
      </Placeholder>
    </>
  );
}
