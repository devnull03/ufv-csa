"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "~/app/(site)/components/UI/button";
import { Checkbox } from "~/app/(site)/components/UI/checkbox";
import { Input } from "~/app/(site)/components/UI/input";
import { Label } from "~/app/(site)/components/UI/label";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES } from "../constants";
import type { ParsedGcodeSummary } from "../db/schema";
import { formatDateTime, formatTime } from "../format";
import { GcodeSummaryCard, WizardStepper } from "./booking";
import { Placeholder } from "./Placeholder";

// Wireframe of the 4-step booking flow (DESIGN_BRIEF §4.4). The data flow is
// real; every visual piece is a placeholder for the design agent.

interface UploadResult {
  id: string;
  originalName: string;
  summary: ParsedGcodeSummary;
  thumbnailUrl: string | null;
}

interface SlotOption {
  start: string;
  end: string;
  runsPastClose: boolean;
}

const STEPS = ["Upload", "Review", "Pick time", "Confirm"];

export function BookingWizard({ printerModel }: { printerModel: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [notes, setNotes] = useState("");
  const [availability, setAvailability] = useState<{ durationMinutes: number; slots: SlotOption[] } | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<SlotOption | null>(null);
  const [accepted, setAccepted] = useState(false);

  const slotsByDay = useMemo(() => {
    const groups = new Map<string, SlotOption[]>();
    for (const option of availability?.slots ?? []) {
      const key = new Date(option.start).toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
      groups.set(key, [...(groups.get(key) ?? []), option]);
    }
    return groups;
  }, [availability]);

  async function fail(response: Response) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    toast.error(body?.message ?? "Something went wrong");
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      toast.error("Upload a .gcode or .bgcode file");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error("Files must be 50 MB or smaller");
      return;
    }
    setBusy(true);
    const response = await fetch("/api/printq/uploads", {
      method: "POST",
      body: file,
      headers: { "x-printq-filename": encodeURIComponent(file.name) },
    });
    setBusy(false);
    if (!response.ok) return fail(response);
    setUpload(await response.json());
    setStep(1);
  }

  async function loadAvailability() {
    if (!upload) return;
    setBusy(true);
    const response = await fetch(`/api/printq/availability?uploadId=${upload.id}`);
    setBusy(false);
    if (!response.ok) return fail(response);
    setAvailability(await response.json());
    setStep(2);
  }

  async function submit() {
    if (!upload || !slot) return;
    setBusy(true);
    const response = await fetch("/api/printq/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId: upload.id, start: slot.start, notes: notes || undefined, acceptedRules: true }),
    });
    setBusy(false);
    if (!response.ok) return fail(response);
    const { booking } = (await response.json()) as { booking: { id: string } };
    toast.success("Requested! You'll get a Discord DM when it's reviewed.");
    router.push(`/printing/me/${booking.id}`);
  }

  return (
    <div className="space-y-4">
      <WizardStepper steps={STEPS} current={step} />

      {step === 0 && (
        <Placeholder name="GcodeDropzone" spec="§4.4 step 1">
          <Label htmlFor="gcode">Upload your sliced file (.gcode or .bgcode, max 50 MB)</Label>
          <Input
            id="gcode"
            type="file"
            accept={ACCEPTED_EXTENSIONS.join(",")}
            disabled={busy}
            onChange={(event) => onFile(event.target.files?.[0])}
          />
          {busy && <p className="mt-2 text-sm">Uploading and reading your file…</p>}
        </Placeholder>
      )}

      {step === 1 && upload && (
        <>
          <GcodeSummaryCard
            name={upload.originalName}
            summary={upload.summary}
            thumbnailUrl={upload.thumbnailUrl}
            printerModel={printerModel}
          />
          <Placeholder name="Notes (Textarea)" spec="§4.4 step 2">
            <Label htmlFor="notes">Notes for the admins (optional)</Label>
            <Input id="notes" maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </Placeholder>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button variant="success" loading={busy} onClick={loadAvailability}>
              Pick a time
            </Button>
          </div>
        </>
      )}

      {step === 2 && availability && (
        <Placeholder name="SlotPicker" spec="§4.4 step 3 / §5.2">
          <p className="mb-2 text-sm text-slate-400">Each booking blocks the printer for {availability.durationMinutes} minutes.</p>
          {slotsByDay.size === 0 ? (
            <p>No free times in the booking window. Try again later.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                {[...slotsByDay.keys()].map((key) => (
                  <Button key={key} size="sm" variant={key === day ? "success" : "outline"} onClick={() => setDay(key)}>
                    {key}
                  </Button>
                ))}
              </div>
              {day && (
                <div className="flex flex-wrap gap-2" data-placeholder="TimeSlotChip">
                  {slotsByDay.get(day)?.map((option) => (
                    <Button
                      key={option.start}
                      size="xs"
                      variant={option.start === slot?.start ? "success" : "secondary"}
                      onClick={() => setSlot(option)}
                    >
                      {formatTime(option.start)} → {formatTime(option.end)}
                      {option.runsPastClose ? " (past close)" : ""}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button variant="success" disabled={!slot} onClick={() => setStep(3)}>
              Continue
            </Button>
          </div>
        </Placeholder>
      )}

      {step === 3 && upload && slot && (
        <Placeholder name="BookingSummary + HoldCountdown" spec="§4.4 step 4">
          <p>
            <strong>{upload.originalName}</strong> on {formatDateTime(slot.start)} until {formatTime(slot.end)}
          </p>
          {notes && <p className="text-sm text-slate-400">Notes: {notes}</p>}
          <label className="mt-3 flex items-center gap-2 text-sm">
            <Checkbox checked={accepted} onCheckedChange={(checked) => setAccepted(checked === true)} />
            I&apos;ve read the rules and will arrive on time
          </label>
          <div className="mt-4 flex gap-2">
            <Button variant="ghost" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button variant="success" loading={busy} disabled={!accepted} onClick={submit}>
              Request booking
            </Button>
          </div>
        </Placeholder>
      )}
    </div>
  );
}
