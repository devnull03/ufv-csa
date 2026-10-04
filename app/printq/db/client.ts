import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { printqEnv } from "../env";

export type PrintQDb = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { printqDb?: PrintQDb };

// Lazily connected and reused across hot reloads in development.
export function db(): PrintQDb {
  if (!globalForDb.printqDb) {
    const client = postgres(printqEnv().DATABASE_URL, { max: 10 });
    globalForDb.printqDb = drizzle(client, { schema });
  }
  return globalForDb.printqDb;
}

export { schema };
