import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { ensureDefaults, seedDemoData } from "./seed";

// Runs once when the server starts (instrumentation.ts): bring the database up
// to date, then start the built-in scheduler. Switches (all optional):
//   PRINTQ_AUTO_SETUP=false   skip migrations and default data on start
//   PRINTQ_SCHEDULER=false    don't run scheduled jobs in this server (e.g. if
//                             something external calls /api/printq/cron)

const log = (message: string) => console.log(`[printq] ${message}`);

/**
 * Applies migrations, then adds the printer and default lab hours if missing,
 * and demo data in demo mode. A Postgres advisory lock makes concurrent starts
 * (several server instances) take turns. Safe to run on every start.
 */
export async function setupDatabase(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  // One connection, so the lock, the migrations and the seed share a session.
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
  try {
    await sql`SELECT pg_advisory_lock(hashtext('printq:setup'))`;
    await migrate(drizzle(sql), { migrationsFolder: path.join(process.cwd(), "drizzle") });
    log("database schema is up to date");
    await ensureDefaults(sql, log);
    if (process.env.PRINTQ_DEMO === "true") await seedDemoData(sql, { log });
    await sql`SELECT pg_advisory_unlock(hashtext('printq:setup'))`;
  } finally {
    await sql.end();
  }
}

export async function startPrintQ() {
  if (process.env.PRINTQ_AUTO_SETUP !== "false") {
    // The database may still be starting (e.g. right after `docker compose up`).
    for (let attempt = 1; ; attempt++) {
      try {
        await setupDatabase();
        break;
      } catch (error) {
        if (attempt >= 10) {
          console.error("[printq] database setup failed; PrintQ pages will error until it succeeds", error);
          break;
        }
        log(`database not ready (${error instanceof Error ? error.message : error}); retrying in 3 s`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }
  if (process.env.PRINTQ_SCHEDULER !== "false") {
    const { startScheduler } = await import("./scheduler");
    startScheduler();
  }
}
