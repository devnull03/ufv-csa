"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button, type ButtonProps } from "~/app/(site)/components/UI/button";
import type { BookingAction } from "../scheduling/state-machine";

const ACTION_UI: Record<Exclude<BookingAction, "expire">, { label: string; variant: ButtonProps["variant"]; askReason?: boolean; confirm?: string }> = {
  approve: { label: "Approve", variant: "success" },
  reject: { label: "Reject", variant: "danger", askReason: true },
  cancel: { label: "Cancel booking", variant: "danger", confirm: "Cancel this booking?" },
  check_in: { label: "Check in", variant: "information" },
  start: { label: "Start print", variant: "information" },
  finish: { label: "Mark finished", variant: "success" },
  fail: { label: "Print failed", variant: "danger", askReason: true },
  collect: { label: "Collected", variant: "success" },
  no_show: { label: "No-show", variant: "warning", confirm: "Mark as no-show?" },
  lab_closed: { label: "Lab closed", variant: "warning" },
};

/**
 * Placeholder controls for booking lifecycle actions (ApprovalCard, SessionCard,
 * CancelBookingDialog and RejectDialog in DESIGN_BRIEF §5.3/§5.4). Uses native
 * prompt/confirm until the real dialogs are designed.
 */
export function BookingActionButtons({ bookingId, actions }: { bookingId: string; actions: BookingAction[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<BookingAction | null>(null);

  async function run(action: Exclude<BookingAction, "expire">) {
    const ui = ACTION_UI[action];
    if (ui.confirm && !window.confirm(ui.confirm)) return;
    const note = ui.askReason ? window.prompt("Reason (shown to the member)") ?? undefined : undefined;
    if (ui.askReason && !note) return;

    setBusy(action);
    const response = await fetch(`/api/printq/bookings/${bookingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note }),
    });
    setBusy(null);
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      toast.error(body?.message ?? "That didn't work");
      return;
    }
    toast.success(`${ui.label}: done`);
    router.refresh();
  }

  return (
    <div data-placeholder="BookingActionButtons" className="flex flex-wrap gap-2">
      {actions
        .filter((action): action is Exclude<BookingAction, "expire"> => action !== "expire")
        .map((action) => (
          <Button key={action} size="sm" variant={ACTION_UI[action].variant} loading={busy === action} onClick={() => run(action)}>
            {ACTION_UI[action].label}
          </Button>
        ))}
    </div>
  );
}
