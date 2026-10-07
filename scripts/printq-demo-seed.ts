/**
 * Fills a PrintQ database with realistic demo data relative to today.
 *
 *   npm run printq:demo-seed            # adds demo data unless it's already there
 *   npm run printq:demo-seed -- --reset # wipes PrintQ bookings/closures/hours first
 *
 * Refuses to run against anything but a local database unless PRINTQ_DEMO=true.
 * (In demo mode the server seeds on start, and staff can reset from the dashboard.)
 */
import postgres from "postgres";
import { seedDemoData } from "../app/printq/setup/seed";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://printq:printq@localhost:5432/printq";
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(databaseUrl);
if (!isLocal && process.env.PRINTQ_DEMO !== "true") {
  console.error("Refusing to seed demo data into a non-local database without PRINTQ_DEMO=true.");
  process.exit(1);
}
const sql = postgres(databaseUrl, { max: 1 });

seedDemoData(sql, { reset: process.argv.includes("--reset") })
  .then(() => sql.end())
  .catch(async (error) => {
    console.error(error);
    await sql.end();
    process.exit(1);
  });
