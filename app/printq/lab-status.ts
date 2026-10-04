import "server-only";

export interface LabStatus {
  open: boolean | null;
  since: string | null;
}

/** Live lab status from the existing /sccroom toggle (Sanity `roomStatus`). Never throws. */
export async function getLabStatus(): Promise<LabStatus> {
  try {
    // Imported lazily: the Sanity client module throws at import time without Sanity env vars.
    const { getLatestRoomStatus } = await import("~/app/sanity/lib/query");
    const [latest] = await getLatestRoomStatus();
    return latest ? { open: latest.status, since: latest._updatedAt } : { open: null, since: null };
  } catch {
    return { open: null, since: null };
  }
}
