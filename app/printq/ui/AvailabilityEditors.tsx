"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

// Staff editors for closures and lab hours. They call the same service as the
// Discord bot, so a change here updates the Discord boards too.

async function call(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { message?: string }).message ?? "Something went wrong");
  return body;
}

interface Affected {
  id: string;
  title: string | null;
  status: string;
  ownerName: string;
  ownerUsername: string | null;
}

export function ClosureForm({ today }: { today: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ date: today, allDay: false, from: "12:00", to: "13:00", kind: "closure", reason: "" });
  const [affected, setAffected] = useState<Affected[] | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch });
    setAffected(null);
  };

  async function submit(mode: "preview" | "notify" | "keep") {
    setBusy(true);
    try {
      const result = await call("/api/printq/admin/closures", { method: "POST", body: JSON.stringify({ ...form, mode }) });
      if (mode === "preview") {
        const list = (result as { affected: Affected[] }).affected;
        if (list.length === 0) return await submit("keep");
        setAffected(list);
        return;
      }
      const { changed } = result as { changed: number };
      toast.success(changed ? `Closure added · ${changed} booking${changed === 1 ? "" : "s"} closed and messaged` : "Closure added");
      setAffected(null);
      setForm({ ...form, reason: "" });
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't add the closure");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="pq-panel flex flex-col gap-4 p-5"
      onSubmit={(event) => {
        event.preventDefault();
        void submit("preview");
      }}
    >
      <h6>Add a closure</h6>
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
        <div className="field">
          <label htmlFor="pq-closure-date">Date</label>
          <input id="pq-closure-date" type="date" className="input" value={form.date} min={today} onChange={(event) => set({ date: event.target.value })} required />
        </div>
        <div className="field">
          <label htmlFor="pq-closure-from">From</label>
          <input id="pq-closure-from" type="time" step={900} className="input" value={form.from} disabled={form.allDay} onChange={(event) => set({ from: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="pq-closure-to">To</label>
          <input id="pq-closure-to" type="time" step={900} className="input" value={form.to} disabled={form.allDay} onChange={(event) => set({ to: event.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="pq-closure-kind">Type</label>
          <select id="pq-closure-kind" className="input" value={form.kind} onChange={(event) => set({ kind: event.target.value })}>
            <option value="closure">Lab closed (no new prints start)</option>
            <option value="maintenance">Printer maintenance (blocks everything)</option>
          </select>
        </div>
      </div>
      <label className="inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.allDay} onChange={(event) => set({ allDay: event.target.checked })} />
        All day
      </label>
      <div className="field">
        <label htmlFor="pq-closure-reason">Reason (shown on the schedule)</label>
        <input id="pq-closure-reason" className="input" maxLength={120} value={form.reason} placeholder="e.g. CSA general meeting" onChange={(event) => set({ reason: event.target.value })} required />
      </div>
      {affected ? (
        <div className="pq-panel flex flex-col gap-3 p-4" role="alert">
          <p>
            This affects <strong>{affected.length}</strong> booking{affected.length === 1 ? "" : "s"}:
          </p>
          <ul className="pq-soft list-disc pl-5 text-sm">
            {affected.map((item) => (
              <li key={item.id}>
                {item.title ?? "Print"} · {item.ownerUsername ? `@${item.ownerUsername}` : item.ownerName} · {item.status}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-danger" disabled={busy} onClick={() => submit("notify")}>
              Close and notify {affected.length}
            </button>
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => submit("keep")}>
              Add, keep bookings
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setAffected(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Add closure
          </button>
        </div>
      )}
    </form>
  );
}

export function RemoveClosureButton({ id, label }: { id: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      aria-label={`Remove ${label}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await call(`/api/printq/admin/closures?id=${id}`, { method: "DELETE" });
          toast.success("Closure removed");
          router.refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Couldn't remove it");
        } finally {
          setBusy(false);
        }
      }}
    >
      <Trash2 size={15} strokeWidth={1.5} aria-hidden />
      Remove
    </button>
  );
}

const DAYS = [1, 2, 3, 4, 5, 6, 0];
const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function LabHoursEditor({ initial }: { initial: Record<number, string> }) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState<number | null>(null);

  async function save(weekday: number) {
    setSaving(weekday);
    try {
      await call("/api/printq/admin/lab-hours", { method: "PUT", body: JSON.stringify({ weekday, hours: values[weekday] ?? "" }) });
      toast.success(`${NAMES[weekday]} saved`);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save");
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="pq-panel flex flex-col">
      <div className="flex flex-col gap-1 px-5 pt-5">
        <h6>Lab hours</h6>
        <p className="pq-soft text-sm">
          Prints may <strong>start</strong> inside these hours (Pacific time). Use <code>10:00-18:00</code>, <code>10am-12, 1-5pm</code> or{" "}
          <code>closed</code>.
        </p>
      </div>
      {DAYS.map((weekday, index) => (
        <form
          key={weekday}
          className={`flex flex-wrap items-center gap-3 px-5 py-3 ${index ? "pq-rule-t" : "mt-3 pq-rule-t"}`}
          onSubmit={(event) => {
            event.preventDefault();
            void save(weekday);
          }}
        >
          <label htmlFor={`pq-hours-${weekday}`} className="w-28">
            {NAMES[weekday]}
          </label>
          <input
            id={`pq-hours-${weekday}`}
            className="input"
            style={{ flex: "1 1 200px" }}
            value={values[weekday] ?? ""}
            placeholder="closed"
            onChange={(event) => setValues({ ...values, [weekday]: event.target.value })}
          />
          <button type="submit" className="btn btn-secondary" disabled={saving === weekday}>
            Save
          </button>
        </form>
      ))}
    </div>
  );
}

export function PrinterVariantForm({
  current,
  options,
}: {
  current: { name: string; model: string; bed: string } | null;
  options: { model: string; name: string; bed: string }[];
}) {
  const router = useRouter();
  const [model, setModel] = useState(current?.model ?? options[0]?.model ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="pq-panel flex flex-col gap-3 p-5"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        try {
          await call("/api/printq/admin/printer", { method: "PUT", body: JSON.stringify({ model }) });
          toast.success("Printer saved");
          router.refresh();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : "Couldn't save");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h6>Printer</h6>
      <p className="pq-soft text-sm">
        Which Original Prusa i3 is in the lab? The printer&apos;s screen shows it when idle (&ldquo;Prusa i3 MK3S OK.&rdquo;); an MK3S+ also says MK3S.
        This sets the build volume and which files members must upload.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="field" style={{ flex: "1 1 260px" }}>
          <label htmlFor="pq-printer-model">Model</label>
          <select id="pq-printer-model" className="input" value={model} onChange={(event) => setModel(event.target.value)}>
            {options.map((option) => (
              <option key={option.model} value={option.model}>
                {option.name} · {option.bed} mm
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn btn-primary" disabled={busy || model === current?.model}>
          Save
        </button>
      </div>
      {current ? (
        <span className="pq-muted text-[13px]">
          Now: {current.name} · {current.bed} mm
        </span>
      ) : null}
    </form>
  );
}
