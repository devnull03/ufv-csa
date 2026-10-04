import { existsSync } from "node:fs";
import { defineConfig } from "drizzle-kit";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  dialect: "postgresql",
  schema: "./app/printq/db/schema.ts",
  out: "./drizzle",
  schemaFilter: ["printq"],
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://printq:printq@localhost:5432/printq",
  },
});
