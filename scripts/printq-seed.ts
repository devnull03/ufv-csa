/**
 * Adds a printer and default lab hours if none exist. Safe to re-run.
 * (The server also does this on start; see instrumentation.ts.)
 *   npm run printq:seed
 */
import postgres from "postgres";
import { ensureDefaults } from "../app/printq/setup/seed";

const sql = postgres(process.env.DATABASE_URL ?? "postgres://printq:printq@localhost:5432/printq", { max: 1 });

ensureDefaults(sql)
  .then(() => sql.end())
  .catch(async (error) => {
    console.error(error);
    await sql.end();
    process.exit(1);
  });
