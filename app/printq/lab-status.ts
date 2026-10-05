import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "./db/client";
import { isDemoMode } from "./env";
import { onLabOpened } from "./notify";

export interface LabStatus {
  open: boolean | null;
  since: string | null;
  // "discord": the existing /sccroom toggle (Sanity). "printq": PrintQ's own toggle (demo / no Sanity).
  source: "discord" | "printq";
}

const KEY = "labStatus";

/** Lab status comes from /sccroom when the CMS is reachable; otherwise PrintQ's own toggle. */
export function usesLocalLabStatus() {
  const projectId = process.env.NEXT_PUBLIC_SANITY_PROJECT_ID;
  return isDemoMode() || !projectId || projectId === "dummy000";
}

/** Never throws. */
export async function getLabStatus(): Promise<LabStatus> {
  if (usesLocalLabStatus()) {
    try {
      const [row] = await db().select().from(schema.settings).where(eq(schema.settings.key, KEY)).limit(1);
      const value = row?.value as { open?: boolean; since?: string } | undefined;
      return { open: value?.open ?? null, since: value?.since ?? null, source: "printq" };
    } catch {
      return { open: null, since: null, source: "printq" };
    }
  }
  try {
    // Imported lazily: the Sanity client module throws at import time without Sanity env vars.
    const { getLatestRoomStatus } = await import("~/app/sanity/lib/query");
    const [latest] = await getLatestRoomStatus();
    return latest ? { open: latest.status, since: latest._updatedAt, source: "discord" } : { open: null, since: null, source: "discord" };
  } catch {
    return { open: null, since: null, source: "discord" };
  }
}

/** PrintQ's own lab toggle (demo mode / no CMS). Opening the lab runs the lab-opened hook. */
export async function setLabStatus(open: boolean, actorId: string) {
  const value = { open, since: new Date().toISOString() };
  await db()
    .insert(schema.settings)
    .values({ key: KEY, value, updatedBy: actorId })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value, updatedBy: actorId, updatedAt: new Date() } });
  if (open) await onLabOpened();
  return value;
}
