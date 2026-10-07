import { SettingsPanel } from "~/app/printq/components/admin";
import { PrintQHeader } from "~/app/printq/components/shared";
import { LabHoursSummary } from "~/app/printq/components/schedule";
import { db, schema } from "~/app/printq/db/client";
import { getSettings } from "~/app/printq/settings";
import { PRINTER_SPECS } from "~/app/printq/printers";
import { LabHoursEditor, PrinterVariantForm } from "~/app/printq/ui/AvailabilityEditors";
import { requireRolePage } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

// DESIGN_BRIEF §4.11. Lab hours are editable (shared with /printstaff hours in Discord); the rest are read-only placeholders.
export default async function SettingsPage() {
  await requireRolePage("admin", "/printing/admin/settings");
  const database = db();
  const [settings, hours, printers] = await Promise.all([
    getSettings(),
    database.select().from(schema.labHours),
    database.select().from(schema.printers),
  ]);

  const printer = printers.find((row) => row.status !== "retired") ?? null;

  return (
    <>
      <PrintQHeader title="Settings" />
      <LabHoursSummary weeklyHours={hours} />
      <LabHoursEditor
        initial={Object.fromEntries(
          [0, 1, 2, 3, 4, 5, 6].map((weekday) => [
            weekday,
            hours
              .filter((row) => row.weekday === weekday && row.printerId === null)
              .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
              .map((row) => `${row.opensAt.slice(0, 5)}-${row.closesAt.slice(0, 5)}`)
              .join(", "),
          ])
        )}
      />
      <SettingsPanel name="PolicyForm" spec="§4.11" value={settings} />
      <PrinterVariantForm
        current={printer ? { name: printer.name, model: printer.model, bed: `${printer.bedX}×${printer.bedY}×${printer.bedZ}` } : null}
        options={PRINTER_SPECS.map((spec) => ({ model: spec.model, name: spec.name, bed: `${spec.bed.x}×${spec.bed.y}×${spec.bed.z}` }))}
      />
    </>
  );
}
