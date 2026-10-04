import InternalLinkButton from "~/app/(site)/components/General/InternalLinkButton";
import { SignOutButton } from "~/app/printq/components/auth";
import { BookingCard } from "~/app/printq/components/booking";
import { Placeholder } from "~/app/printq/components/Placeholder";
import { EmptyState, PrintQHeader, QuotaMeter } from "~/app/printq/components/shared";
import { SLOT_HOLDING_STATUSES } from "~/app/printq/constants";
import { listMyBookings } from "~/app/printq/queries";
import { getSettings } from "~/app/printq/settings";
import { requireMemberPage } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "My prints" };

const UPCOMING = new Set<string>([...SLOT_HOLDING_STATUSES, "finished"]);

// DESIGN_BRIEF §4.5
export default async function MyPrintsPage() {
  const viewer = await requireMemberPage("/printing/me");
  const [bookings, settings] = await Promise.all([listMyBookings(viewer.userId), getSettings()]);
  const upcoming = bookings.filter((booking) => UPCOMING.has(booking.status));
  const past = bookings.filter((booking) => !UPCOMING.has(booking.status));
  const active = bookings.filter((booking) => (SLOT_HOLDING_STATUSES as readonly string[]).includes(booking.status)).length;

  return (
    <>
      <PrintQHeader
        title="My prints"
        description={`Signed in as ${viewer.name}`}
        actions={
          <>
            <QuotaMeter used={active} max={settings.maxActiveBookingsPerUser} />
            <InternalLinkButton href="/printing/new" variant="success">
              Book a print
            </InternalLinkButton>
            <SignOutButton />
          </>
        }
      />
      {bookings.length === 0 ? (
        <EmptyState title="No prints yet" body="Book your first print to see it here." />
      ) : (
        <Placeholder name="Tabs (Upcoming / Past)" spec="§4.5">
          {[
            { title: "Upcoming", items: upcoming },
            { title: "Past", items: past },
          ].map((group) => (
            <div key={group.title} className="mb-4 space-y-2">
              <h2 className="font-semibold">{group.title}</h2>
              {group.items.length === 0 && <p className="text-sm text-slate-400">Nothing here.</p>}
              {group.items.map((booking) => (
                <BookingCard
                  key={booking.id}
                  booking={booking}
                  actions={
                    <InternalLinkButton href={`/printing/me/${booking.id}`} variant="ghost" size="sm">
                      View
                    </InternalLinkButton>
                  }
                />
              ))}
            </div>
          ))}
        </Placeholder>
      )}
    </>
  );
}
