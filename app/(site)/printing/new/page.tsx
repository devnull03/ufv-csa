import { getActivePrinter } from "~/app/printq/schedule";
import { BookingFlow } from "~/app/printq/ui/BookingFlow";
import { requireMemberPage } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book a print" };

// Screens 03–06: upload, choose time, review, request sent.
export default async function NewBookingPage() {
  await requireMemberPage("/printing/new");
  const printer = await getActivePrinter().catch(() => null);
  if (!printer) {
    return (
      <div className="pq-panel flex flex-col gap-2 p-8">
        <h2>Booking is closed</h2>
        <p className="pq-soft">No printer is available right now. Check back soon.</p>
      </div>
    );
  }
  return (
    <BookingFlow
      printer={{ name: printer.name, model: printer.model, bedX: printer.bedX, bedY: printer.bedY, bedZ: printer.bedZ }}
    />
  );
}
