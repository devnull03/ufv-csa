/**
 * Seeds a printer and default lab hours if none exist. Safe to re-run.
 *   npx tsx --env-file=.env.local scripts/printq-seed.ts
 */
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL ?? "postgres://printq:printq@localhost:5432/printq", { max: 1 });

async function main() {
  const [{ printers }] = await sql`SELECT count(*)::int AS printers FROM printq.printers`;
  if (printers === 0) {
    const model = process.env.PRINTQ_PRINTER_MODEL ?? "MK4S";
    await sql`
      INSERT INTO printq.printers (name, model, bed_x_mm, bed_y_mm, bed_z_mm)
      VALUES (${`Prusa ${model}`}, ${model}, 250, 210, 220)`;
    console.log(`Added printer: Prusa ${model}`);
  }

  const [{ hours }] = await sql`SELECT count(*)::int AS hours FROM printq.lab_hours`;
  if (hours === 0) {
    // Placeholder hours (Mon–Fri 10:00–16:00) until admins set real ones in Settings.
    for (const weekday of [1, 2, 3, 4, 5]) {
      await sql`INSERT INTO printq.lab_hours (weekday, opens_at, closes_at) VALUES (${weekday}, '10:00', '16:00')`;
    }
    console.log("Added default lab hours: Mon–Fri 10:00–16:00");
  }
}

main()
  .then(() => sql.end())
  .catch(async (error) => {
    console.error(error);
    await sql.end();
    process.exit(1);
  });
