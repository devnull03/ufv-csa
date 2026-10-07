"use client";

import { DoorClosed, DoorOpen, Play, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

/** Lab open/closed toggle for when /sccroom isn't connected (demo mode). */
export function LabToggle({ open }: { open: boolean | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function set(next: boolean) {
    setBusy(true);
    const response = await fetch("/api/printq/lab-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ open: next }),
    });
    setBusy(false);
    if (!response.ok) return toast.error("Couldn't change the lab status");
    toast.success(next ? "Lab marked open" : "Lab marked closed");
    router.refresh();
  }
  return open ? (
    <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => set(false)}>
      <DoorClosed size={15} strokeWidth={1.5} aria-hidden />
      Close the lab
    </button>
  ) : (
    <button type="button" className="btn btn-primary" disabled={busy} onClick={() => set(true)}>
      <DoorOpen size={15} strokeWidth={1.5} aria-hidden />
      Open the lab
    </button>
  );
}

/** Demo mode: run the cron jobs now instead of waiting for the timer. */
export function RunJobsButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        const response = await fetch("/api/printq/admin/run-jobs", { method: "POST" });
        setBusy(false);
        if (!response.ok) return toast.error("Jobs failed");
        const report = (await response.json()) as { expiredHolds: string[]; remindersSent: number; purgedUploads: number };
        toast.success(`Expired ${report.expiredHolds.length} holds · ${report.remindersSent} reminders · purged ${report.purgedUploads} files`);
        router.refresh();
      }}
    >
      <Play size={15} strokeWidth={1.5} aria-hidden />
      Run scheduled jobs now
    </button>
  );
}

/** Demo mode: start over with fresh demo bookings. */
export function ResetDemoButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("Delete all bookings, closures and lab hours and load fresh demo data?")) return;
        setBusy(true);
        const response = await fetch("/api/printq/admin/demo-reset", { method: "POST" });
        setBusy(false);
        if (!response.ok) return toast.error("Reset failed");
        toast.success("Demo data reset");
        router.refresh();
      }}
    >
      <RotateCcw size={15} strokeWidth={1.5} aria-hidden />
      Reset demo data
    </button>
  );
}
