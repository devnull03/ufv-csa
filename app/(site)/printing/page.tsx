import InternalLinkButton from "~/app/(site)/components/General/InternalLinkButton";
import { Placeholder } from "~/app/printq/components/Placeholder";
import { EmptyState, LabStatusBadge, PrintQHeader, StepsStrip } from "~/app/printq/components/shared";
import { LabHoursSummary, WeekSchedule } from "~/app/printq/components/schedule";
import { PRINTQ_TIMEZONE } from "~/app/printq/constants";
import { getLabStatus } from "~/app/printq/lab-status";
import { getActivePrinter, loadScheduleData } from "~/app/printq/schedule";
import { addLocalDays, fromLocal, localDateOf } from "~/app/printq/scheduling/time";
import { getViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

// DESIGN_BRIEF §4.1
export default async function PrintingPage() {
  const [viewer, labStatus, printer] = await Promise.all([
    getViewer(),
    getLabStatus(),
    getActivePrinter().catch(() => null),
  ]);

  // Rolling 7 days from today, so upcoming slots are visible on any weekday.
  const today = localDateOf(new Date(), PRINTQ_TIMEZONE);
  const weekStart = fromLocal({ ...today, hour: 0, minute: 0 }, PRINTQ_TIMEZONE);
  const weekEnd = fromLocal({ ...addLocalDays(today, 7), hour: 0, minute: 0 }, PRINTQ_TIMEZONE);
  const schedule = printer ? await loadScheduleData(printer.id, { start: weekStart, end: weekEnd }) : null;

  return (
    <>
      <PrintQHeader
        title="3D Printing"
        description="Free for CSA members. Slice it, book it, print it."
        actions={
          <>
            <LabStatusBadge open={labStatus.open} since={labStatus.since} />
            <InternalLinkButton href={viewer ? "/printing/new" : "/printing/login?next=/printing/new"} variant="success">
              {viewer ? "Book a print" : "Sign in with Discord"}
            </InternalLinkButton>
            {viewer && (
              <InternalLinkButton href="/printing/me" variant="ghost">
                My prints
              </InternalLinkButton>
            )}
          </>
        }
      />

      {!printer || !schedule ? (
        <EmptyState title="Schedule coming soon" body="No printer has been set up yet." />
      ) : (
        <>
          <Placeholder name="PrinterCard" spec="§4.1">
            <p className="font-semibold">{printer.name}</p>
            <p className="text-sm text-slate-400">
              {printer.model} · {printer.bedX} × {printer.bedY} × {printer.bedZ} mm
            </p>
          </Placeholder>
          <WeekSchedule
            mode="public"
            weekStart={weekStart}
            weeklyHours={schedule.weeklyHours}
            blocks={[
              ...schedule.bookings.map((booking) => ({
                kind: booking.status === "pending" ? ("pending" as const) : ("booking" as const),
                label: booking.status === "pending" ? "Pending" : "Booked",
                start: booking.start,
                end: booking.end,
              })),
              ...schedule.closures.map((closure) => ({ kind: closure.kind, label: closure.reason, start: closure.start, end: closure.end })),
            ]}
          />
          <LabHoursSummary weeklyHours={schedule.weeklyHours} />
        </>
      )}

      <StepsStrip steps={["Slice in PrusaSlicer", "Upload your file", "Pick a time", "Get approved & print"]} />
    </>
  );
}
