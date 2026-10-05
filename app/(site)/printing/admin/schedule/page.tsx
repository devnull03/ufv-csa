import { Placeholder } from "~/app/printq/components/Placeholder";
import { listUpcomingClosures } from "~/app/printq/availability";
import { closureLine } from "~/app/printq/discord/render";
import { ClosureForm, RemoveClosureButton } from "~/app/printq/ui/AvailabilityEditors";
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
  const [data, closures] = await Promise.all([loadScheduleData(printer.id, { start, end }), listUpcomingClosures()]);

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
      <ClosureForm today={`${today.year}-${String(today.month).padStart(2, "0")}-${String(today.day).padStart(2, "0")}`} />
      <section className="flex flex-col gap-3">
        <h6>Upcoming closures</h6>
        {closures.length === 0 ? (
          <div className="pq-panel pq-soft p-5">None. The lab follows its weekly hours.</div>
        ) : (
          <div className="pq-panel flex flex-col">
            {closures.map((closure, index) => {
              const label = closureLine({ id: closure.id, kind: closure.kind, reason: closure.reason, ...closure.during });
              return (
                <div key={closure.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${index ? "pq-rule-t" : ""}`}>
                  <span className="mr-auto">{label}</span>
                  <RemoveClosureButton id={closure.id} label={label} />
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
