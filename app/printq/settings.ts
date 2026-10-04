import "server-only";
import { sql } from "drizzle-orm";
import { DEFAULT_SETTINGS, type PrintQSettings } from "./constants";
import { db, schema } from "./db/client";

// Settings rows override the defaults key by key; unknown keys are ignored.
export async function getSettings(): Promise<PrintQSettings> {
  const rows = await db().select({ key: schema.settings.key, value: schema.settings.value }).from(schema.settings);
  const settings: PrintQSettings = { ...DEFAULT_SETTINGS };
  for (const { key, value } of rows) {
    if (key in DEFAULT_SETTINGS && typeof value === typeof DEFAULT_SETTINGS[key as keyof PrintQSettings]) {
      (settings as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return settings;
}

export async function updateSettings(patch: Partial<PrintQSettings>, actorId: string) {
  const entries = Object.entries(patch).filter(([key]) => key in DEFAULT_SETTINGS);
  if (entries.length === 0) return;
  await db()
    .insert(schema.settings)
    .values(entries.map(([key, value]) => ({ key, value, updatedBy: actorId, updatedAt: new Date() })))
    .onConflictDoUpdate({
      target: schema.settings.key,
      set: { value: sql`excluded.value`, updatedBy: actorId, updatedAt: new Date() },
    });
}
