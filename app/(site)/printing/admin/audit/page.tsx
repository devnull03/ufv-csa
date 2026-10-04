import { desc, eq } from "drizzle-orm";
import { Placeholder } from "~/app/printq/components/Placeholder";
import { PrintQHeader } from "~/app/printq/components/shared";
import { db, schema } from "~/app/printq/db/client";
import { formatDateTime } from "~/app/printq/format";
import { requireRolePage } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit log" };

// DESIGN_BRIEF §4.13
export default async function AuditPage() {
  await requireRolePage("admin", "/printing/admin/audit");
  const events = await db()
    .select({
      id: schema.bookingEvents.id,
      at: schema.bookingEvents.at,
      action: schema.bookingEvents.action,
      fromStatus: schema.bookingEvents.fromStatus,
      toStatus: schema.bookingEvents.toStatus,
      note: schema.bookingEvents.note,
      bookingId: schema.bookingEvents.bookingId,
      actor: schema.user.name,
    })
    .from(schema.bookingEvents)
    .leftJoin(schema.user, eq(schema.user.id, schema.bookingEvents.actorId))
    .orderBy(desc(schema.bookingEvents.at))
    .limit(200);

  return (
    <>
      <PrintQHeader title="Audit log" />
      <Placeholder name="AuditTable" spec="§4.13">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Status</th>
              <th>Booking</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{formatDateTime(event.at)}</td>
                <td>{event.actor ?? "system"}</td>
                <td>{event.action}</td>
                <td>
                  {event.fromStatus ?? "–"} → {event.toStatus ?? "–"}
                </td>
                <td className="font-mono">{event.bookingId.slice(0, 8)}</td>
                <td>{event.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Placeholder>
    </>
  );
}
