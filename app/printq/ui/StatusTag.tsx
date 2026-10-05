import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  DoorClosed,
  Hourglass,
  LogIn,
  PackageCheck,
  Printer,
  TimerOff,
  UserX,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import type { BookingStatus } from "../constants";
import { STATUS_LABELS } from "../format";

type Tone = "pending" | "approved" | "printing" | "completed" | "declined" | "closed";

const STATUS_STYLE: Record<BookingStatus, { tone: Tone; icon: LucideIcon }> = {
  pending: { tone: "pending", icon: Hourglass },
  approved: { tone: "approved", icon: CheckCircle2 },
  checked_in: { tone: "approved", icon: LogIn },
  printing: { tone: "printing", icon: Printer },
  finished: { tone: "completed", icon: PackageCheck },
  collected: { tone: "completed", icon: PackageCheck },
  rejected: { tone: "declined", icon: XCircle },
  no_show: { tone: "declined", icon: UserX },
  failed: { tone: "declined", icon: AlertTriangle },
  expired: { tone: "pending", icon: TimerOff },
  cancelled: { tone: "pending", icon: Ban },
  lab_closed: { tone: "closed", icon: DoorClosed },
};

/** Status tag (spec C02): always icon + word, never colour alone. Declines may append a short reason. */
export function StatusTag({ status, reason }: { status: BookingStatus; reason?: string | null }) {
  const { tone, icon: Icon } = STATUS_STYLE[status];
  const showReason = reason && (status === "rejected" || status === "failed");
  return (
    <span className={`tag tag-${tone}`}>
      <Icon size={13} strokeWidth={1.5} aria-hidden />
      {STATUS_LABELS[status]}
      {showReason ? ` · ${reason}` : ""}
    </span>
  );
}
