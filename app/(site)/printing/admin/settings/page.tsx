import { SettingsPanel } from "~/app/printq/components/admin";
import { PrintQHeader } from "~/app/printq/components/shared";
import { LabHoursSummary } from "~/app/printq/components/schedule";
import { db, schema } from "~/app/printq/db/client";
import { getSettings } from "~/app/printq/settings";
import { requireRolePage } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

// DESIGN_BRIEF §4.11. Editors are read-only placeholders; saving comes with the real design.
export default async function SettingsPage() {
  await requireRolePage("admin", "/printing/admin/settings");
  const database = db();
  const [settings, hours, printers] = await Promise.all([
    getSettings(),
    database.select().from(schema.labHours),
    database.select().from(schema.printers),
  ]);

  return (
    <>
      <PrintQHeader title="Settings" />
      <LabHoursSummary weeklyHours={hours} />
      <SettingsPanel
        name="LabHoursEditor"
        spec="§4.11"
        value={hours}
        note="Weekday × time ranges in America/Vancouver, plus 'suggest from room history' (from /sccroom toggles)."
      />
      <SettingsPanel name="PolicyForm" spec="§4.11" value={settings} />
      <SettingsPanel name="PrinterForm" spec="§4.11" value={printers} />
    </>
  );
}
