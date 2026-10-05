import { Plus } from "lucide-react";
import Link from "next/link";
import { SignOutButton } from "~/app/printq/components/auth";
import { formatDuration, formatDay, formatTime } from "~/app/printq/format";
import { listMyBookings } from "~/app/printq/queries";
import { StatusTag } from "~/app/printq/ui/StatusTag";
import { requireMemberPage } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "My prints" };

// Screen 07 · My prints: a table on desktop, stacked cards on mobile, newest first.
export default async function MyPrintsPage() {
  const viewer = await requireMemberPage("/printing/me");
  const bookings = await listMyBookings(viewer.userId);
  const rows = bookings.map((booking) => ({
    ...booking,
    slot: `${formatDay(booking.start)}, ${formatTime(booking.start)}`,
    length: formatDuration((booking.end.getTime() - booking.start.getTime()) / 60_000),
  }));

  return (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto flex flex-col gap-1.5">
          <h2>My prints</h2>
          <p className="pq-soft">
            Signed in as {viewer.discordUsername ?? viewer.name} · <SignOutButton />
          </p>
        </div>
        <Link href="/printing/new" className="btn btn-primary btn-md pq-cta">
          <Plus size={16} strokeWidth={1.5} aria-hidden />
          New print
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="pq-panel flex flex-col items-start gap-3 p-8">
          <h3>No prints yet</h3>
          <p className="pq-soft">Slice your model in PrusaSlicer, then book a time on the printer.</p>
          <Link href="/printing/new" className="btn btn-primary btn-md">
            Book a print
          </Link>
        </div>
      ) : (
        <>
          <div className="pq-panel pq-desk-only overflow-x-auto">
            <table className="table" style={{ minWidth: 680 }}>
              <thead>
                <tr>
                  <th>Print</th>
                  <th>Slot</th>
                  <th>Length</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/printing/me/${row.id}`} className="pq-heading" style={{ fontSize: 19, color: "var(--color-text)", textDecoration: "none" }}>
                        {row.title}
                      </Link>
                    </td>
                    <td className="pq-num">{row.slot}</td>
                    <td className="pq-muted">{row.length}</td>
                    <td>
                      <StatusTag status={row.status} reason={row.decisionReason} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pq-panel pq-mob-only flex flex-col">
            {rows.map((row, index) => (
              <Link
                key={row.id}
                href={`/printing/me/${row.id}`}
                className={`flex flex-col gap-1.5 px-4 py-3.5 ${index ? "pq-rule-t" : ""}`}
                style={{ color: "var(--color-text)", textDecoration: "none" }}
              >
                <span className="pq-heading" style={{ fontSize: 20 }}>
                  {row.title}
                </span>
                <span className="pq-muted pq-num text-[13px]">
                  {row.slot} · {row.length}
                </span>
                <span className="self-start">
                  <StatusTag status={row.status} reason={row.decisionReason} />
                </span>
              </Link>
            ))}
          </div>
        </>
      )}
    </>
  );
}
