import "server-only";
import { isPrintQEnabled } from "./env";
import { onAvailabilityChanged, onLabOpened } from "./notify";

/**
 * Called by the existing /sccroom handler (and the staff board's lab button)
 * after the room status is saved. When the lab opens, members with approved
 * bookings today get a heads-up; either way the Discord boards are refreshed.
 * Must never throw into /sccroom.
 */
export async function onRoomStatusChange(isOpen: boolean): Promise<void> {
  if (!isPrintQEnabled()) return;
  try {
    if (isOpen) await onLabOpened();
    await onAvailabilityChanged();
  } catch (error) {
    console.error("PrintQ room status hook failed", error);
  }
}
