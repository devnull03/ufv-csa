import "server-only";
import { isPrintQEnabled } from "./env";
import { onLabOpened } from "./notify";

/**
 * Called by the existing /sccroom handler after the room status is saved.
 * When the lab opens, members with approved bookings today get a heads-up.
 * Must never throw into /sccroom.
 */
export async function onRoomStatusChange(isOpen: boolean): Promise<void> {
  if (!isPrintQEnabled() || !isOpen) return;
  try {
    await onLabOpened();
  } catch (error) {
    console.error("PrintQ lab-opened hook failed", error);
  }
}
