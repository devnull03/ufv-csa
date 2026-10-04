import { BookingWizard } from "~/app/printq/components/BookingWizard";
import { EmptyState, PrintQHeader } from "~/app/printq/components/shared";
import { getActivePrinter } from "~/app/printq/schedule";
import { requireMemberPage } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book a print" };

// DESIGN_BRIEF §4.4
export default async function NewBookingPage() {
  await requireMemberPage("/printing/new");
  const printer = await getActivePrinter().catch(() => null);
  return (
    <>
      <PrintQHeader title="Book a print" description="Upload your sliced file, pick a time, and an admin will confirm it." />
      {printer ? (
        <BookingWizard printerModel={printer.model} />
      ) : (
        <EmptyState title="Booking is closed" body="No printer is available right now." />
      )}
    </>
  );
}
