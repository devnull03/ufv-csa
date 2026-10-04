import "server-only";
import { isPrintQEnabled } from "./env";

/**
 * Called by the existing /sccroom handler after the room status is saved.
 * Must never throw into /sccroom.
 *
 * TODO(phase 3): when the lab opens, DM members with approved bookings today;
 * when it closes, flag bookings whose slot starts while closed as `lab_closed`.
 */
export async function onRoomStatusChange(isOpen: boolean): Promise<void> {
  if (!isPrintQEnabled()) return;
  void isOpen;
}
