import Link from "next/link";
import { BookingActionButtons } from "~/app/printq/components/BookingActionButtons";
import { isDemoMode, discordBotConfigured } from "~/app/printq/env";
import { formatDateTime, formatSlot } from "~/app/printq/format";
import { getLabStatus } from "~/app/printq/lab-status";
import { recentNotifications } from "~/app/printq/notify";
import { countPending, listBookingsForStaff } from "~/app/printq/queries";
import { allowedActions } from "~/app/printq/scheduling/state-machine";
import { LabToggle, ResetDemoButton, RunJobsButton } from "~/app/printq/ui/StaffControls";
import { StatusTag } from "~/app/printq/ui/StatusTag";

export const dynamic = "force-dynamic";
export const metadata = { title: "Staff" };

// Staff dashboard: today at a glance, the lab toggle (demo), and every message PrintQ sent.
export default async function AdminDashboardPage() {
  const [pending, today, labStatus, outbox] = await Promise.all([
    countPending(),
    listBookingsForStaff({ today: true }),
    getLabStatus(),
    recentNotifications(),
  ]);
  const printing = today.filter((booking) => booking.status === "printing");
  const demo = isDemoMode();

  return (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <div className="mr-auto flex flex-col gap-1.5">
          <span className="pq-overline">PrintQ · Staff</span>
          <h2>Dashboard</h2>
        </div>
        {labStatus.source === "printq" ? <LabToggle open={labStatus.open} /> : null}
        {demo ? <RunJobsButton /> : null}
        {demo ? <ResetDemoButton /> : null}
      </div>

      <div className="pq-stats" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        {[
          ["Pending approvals", String(pending), "/printing/admin/approvals"],
          ["Today's prints", String(today.length), "/printing/admin/session"],
          ["Printing now", String(printing.length), "/printing/admin/session"],
          ["Lab", labStatus.open === null ? "Unknown" : labStatus.open ? "Open" : "Closed", null],
        ].map(([label, value, href], index) => (
          <div key={label} style={index ? { borderLeft: "1px solid var(--color-divider)", borderTop: 0 } : undefined}>
            <span className="pq-label">{label}</span>
            {href ? (
              <Link href={href} className="pq-value" style={{ fontSize: 30, color: "var(--color-text)", textDecoration: "none" }}>
                {value}
              </Link>
            ) : (
              <span className="pq-value" style={{ fontSize: 30 }}>
                {value}
              </span>
            )}
            <span className="pq-muted text-xs">
              {label === "Lab"
                ? labStatus.source === "discord"
                  ? "Toggle with /sccroom in Discord"
                  : labStatus.since
                    ? `Since ${formatDateTime(labStatus.since)}`
                    : "Use the button above"
                : ""}
            </span>
          </div>
        ))}
      </div>

      <section className="flex flex-col gap-3">
        <h6>Today</h6>
        {today.length === 0 ? (
          <div className="pq-panel pq-soft p-5">Nothing booked today.</div>
        ) : (
          <div className="pq-panel flex flex-col">
            {today.map((booking, index) => (
              <div key={booking.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 ${index ? "pq-rule-t" : ""}`}>
                <div className="mr-auto flex min-w-0 flex-col">
                  <span className="pq-heading" style={{ fontSize: 19 }}>
                    {booking.item.title}
                  </span>
                  <span className="pq-muted pq-num text-[13px]">
                    {formatSlot(booking.slot.start, booking.slot.end)} · {booking.ownerUsername ?? booking.ownerName}
                  </span>
                </div>
                <StatusTag status={booking.status} />
                <BookingActionButtons
                  bookingId={booking.id}
                  actions={allowedActions(booking.status, "staff").filter((action) => action !== "cancel")}
                  appearance="pq"
                />
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
          <h6 className="mr-auto">Messages sent</h6>
          <span className="pq-muted text-[13px]">
            {discordBotConfigured() ? "Delivered through the Discord bot" : "Outbox only: the Discord bot is off (demo mode or not configured)"}
          </span>
        </div>
        <div className="pq-panel overflow-x-auto">
          <table className="table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>When</th>
                <th>To</th>
                <th>Message</th>
                <th>Delivery</th>
              </tr>
            </thead>
            <tbody>
              {outbox.length === 0 ? (
                <tr>
                  <td colSpan={4} className="pq-muted">
                    No messages yet. Book a print, approve it, or run the scheduled jobs.
                  </td>
                </tr>
              ) : (
                outbox.map((message) => (
                  <tr key={message.id}>
                    <td className="pq-num pq-muted whitespace-nowrap">{formatDateTime(message.createdAt)}</td>
                    <td className="whitespace-nowrap">{message.recipient ?? (message.channelId ? "#admin channel" : "Admin channel")}</td>
                    <td>
                      <div className="font-medium">{message.title}</div>
                      <div className="pq-soft text-[13px]" style={{ whiteSpace: "pre-line" }}>
                        {message.body.replace(/\*\*/g, "")}
                      </div>
                    </td>
                    <td>
                      <span className={`tag ${message.delivery === "discord" ? "tag-approved" : message.delivery === "failed" ? "tag-declined" : "tag-pending"}`}>
                        {message.delivery}
                      </span>
                      {message.error ? <div className="pq-note-error text-xs">{message.error}</div> : null}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
