"use client";

import { SiDiscord } from "@icons-pack/react-simple-icons";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FastForward,
  FileCode2,
  Loader2,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  Timer,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState, type DragEvent } from "react";
import type { CalendarData } from "../calendar";
import { ACCEPTED_EXTENSIONS, MAX_UPLOAD_BYTES, type BookingPurpose } from "../constants";
import type { ParsedGcodeSummary } from "../db/schema";
import { formatDay, formatDuration, formatTime } from "../format";
import { fitsBuildVolume, printerModelMatches } from "../gcode/model";
import { availableStarts, explainStart, type StartProblem } from "../scheduling/slots";
import { WeekCalendar } from "./WeekCalendar";

// Screens 03–06 of the PrintQ design: upload, choose time, review, request sent.

export interface FlowPrinter {
  name: string;
  model: string;
  bedX: number;
  bedY: number;
  bedZ: number;
}

interface UploadResult {
  id: string;
  originalName: string;
  sizeBytes: number;
  summary: ParsedGcodeSummary;
  thumbnailUrl: string | null;
}

interface Availability {
  length: { defaultMinutes: number; minMinutes: number; maxMinutes: number };
  fileMinutes: number;
  stepMinutes: number;
  earliestStart: string;
  mustFinishInLabHours: boolean;
  calendar: CalendarData;
}

type Step = "upload" | "time" | "review" | "done";

const STEPS: { id: Exclude<Step, "done">; label: string }[] = [
  { id: "upload", label: "Upload file" },
  { id: "time", label: "Choose time" },
  { id: "review", label: "Review & submit" },
];

const PURPOSES: { id: BookingPurpose; label: string }[] = [
  { id: "course", label: "Course" },
  { id: "club", label: "Club" },
  { id: "personal", label: "Personal" },
];

const PROBLEM_TEXT: Record<StartProblem, string> = {
  past: "That time has passed",
  closed: "Lab closed",
  before_open: "Before the lab opens",
  after_close: "After the lab closes",
  runs_past_close: "Runs past closing",
  overlaps_booking: "Overlaps a booking",
  overlaps_pending: "Overlaps a pending request",
  overlaps_maintenance: "Overlaps maintenance",
};

async function readError(response: Response) {
  const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
  return { code: body?.error ?? "error", message: body?.message ?? "Something went wrong. Try again." };
}

export function BookingFlow({ printer }: { printer: FlowPrinter }) {
  const [step, setStep] = useState<Step>("upload");
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const [busy, setBusy] = useState<"uploading" | "reading" | "submitting" | null>(null);
  const [uploadError, setUploadError] = useState<{ title: string; body: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [durationOverride, setDurationOverride] = useState<number | null>(null);
  const [editingDuration, setEditingDuration] = useState(false);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState<BookingPurpose>("course");
  const [notes, setNotes] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [flash, setFlash] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const defaultMinutes = availability?.length.defaultMinutes ?? 0;
  const duration = durationOverride ?? defaultMinutes;
  const fileMinutes = availability?.fileMinutes ?? 0;

  const loadAvailability = useCallback(async (uploadId: string) => {
    const response = await fetch(`/api/printq/availability?uploadId=${uploadId}`);
    if (!response.ok) throw new Error((await readError(response)).message);
    const data = (await response.json()) as Availability;
    setAvailability(data);
    return data;
  }, []);

  // --- Picker rules, mirrored from the server (which re-checks on submit) ---
  const context = useMemo(() => {
    if (!availability) return null;
    const { calendar } = availability;
    return {
      windows: calendar.windows.map((window) => ({ start: new Date(window.start), end: new Date(window.end) })),
      busy: calendar.blocks
        .filter((block) => block.kind !== "closure")
        .map((block) => ({
          start: new Date(block.start),
          end: new Date(block.end),
          kind: block.kind === "pending" ? ("pending" as const) : block.kind === "maintenance" ? ("maintenance" as const) : ("booking" as const),
        })),
      earliestStart: new Date(availability.earliestStart),
      mustFinishInLabHours: availability.mustFinishInLabHours,
      timeZone: calendar.timeZone,
    };
  }, [availability]);

  const problemAt = useCallback(
    (start: Date, minutes = duration) => {
      if (!context) return "Loading";
      const problem = explainStart(start, minutes, context);
      return problem ? PROBLEM_TEXT[problem] : null;
    },
    [context, duration]
  );

  const earliest = useCallback(
    (minutes = duration) =>
      context && availability
        ? availableStarts({ ...context, durationMinutes: minutes, stepMinutes: availability.stepMinutes })[0] ?? null
        : null,
    [context, availability, duration]
  );

  // --- Upload ---
  async function handleFile(file: File | undefined) {
    if (!file || busy) return;
    setUploadError(null);
    if (!ACCEPTED_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext))) {
      setUploadError({ title: "That's not a G-code file", body: "Export a .gcode or .bgcode file from PrusaSlicer." });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setUploadError({ title: "File is too large", body: "Files must be 50 MB or smaller." });
      return;
    }
    setBusy("uploading");
    try {
      const response = await fetch("/api/printq/uploads", {
        method: "POST",
        body: file,
        headers: { "x-printq-filename": encodeURIComponent(file.name) },
      });
      if (!response.ok) {
        const { message } = await readError(response);
        setUploadError({ title: "We couldn't read that file", body: message });
        return;
      }
      setBusy("reading");
      const result = (await response.json()) as UploadResult;
      if (!printerModelMatches(result.summary.printerModel, printer.model)) {
        setUploadError({
          title: "Sliced for a different printer",
          body: `Re-slice with the Prusa ${printer.model} profile and try again.`,
        });
        return;
      }
      if (!result.summary.printSeconds) {
        setUploadError({ title: "No print time in this file", body: "Export it again from PrusaSlicer so it includes the estimate." });
        return;
      }
      if (fitsBuildVolume(result.summary.bbox, printer) === false) {
        setUploadError({ title: "Too big for the build volume", body: `The bed fits ${printer.bedX} × ${printer.bedY} × ${printer.bedZ} mm.` });
        return;
      }
      await loadAvailability(result.id);
      setUpload(result);
      setName((current) => current || result.originalName.replace(/\.b?gcode$/i, "").replace(/[_-]+/g, " ").slice(0, 120));
      setDurationOverride(null);
      setSelected(null);
    } catch (error) {
      setUploadError({ title: "Upload failed", body: error instanceof Error ? error.message : "Try again." });
    } finally {
      setBusy(null);
    }
  }

  function clearFile() {
    setUpload(null);
    setAvailability(null);
    setDurationOverride(null);
    setEditingDuration(false);
    setSelected(null);
  }

  // --- Duration (spec C07) ---
  function setDuration(value: number) {
    if (!availability) return;
    const { minMinutes, maxMinutes } = availability.length;
    const next = Math.max(minMinutes, Math.min(maxMinutes, value));
    setDurationOverride(next === defaultMinutes ? null : next);
    if (selected && problemAt(new Date(selected), next)) {
      setSelected(null);
      setFlash("Your slot no longer fits the new length. Pick again.");
    }
  }
  const edited = duration !== defaultMinutes;
  const underFile = duration < fileMinutes;
  const margin = defaultMinutes - fileMinutes;
  const durationNote = !edited
    ? `File estimate ${formatDuration(fileMinutes)}${margin > 0 ? ` + ${formatDuration(margin)} margin` : ""}`
    : underFile
      ? `Shorter than the file estimate (${formatDuration(fileMinutes)}). Staff may decline.`
      : duration > defaultMinutes
        ? `Includes ${formatDuration(duration - defaultMinutes)} extra over the recommended ${formatDuration(defaultMinutes)}`
        : `Less margin than the recommended ${formatDuration(defaultMinutes)}`;
  const durationNoteShort = !edited
    ? "From file"
    : underFile
      ? `Under file estimate (${formatDuration(fileMinutes)})`
      : duration > defaultMinutes
        ? `+${formatDuration(duration - defaultMinutes)} buffer`
        : "Less margin";
  const noteClass = underFile ? "pq-note-caution" : edited ? "pq-note-edited" : "pq-muted";

  const stepper = (compact = false) => (
    <div className="pq-stepper" style={compact ? undefined : { alignSelf: "stretch" }}>
      <button type="button" aria-label="15 minutes less" onClick={() => setDuration(duration - 15)} disabled={!availability || duration <= availability.length.minMinutes}>
        <Minus size={16} strokeWidth={1.5} />
      </button>
      <output aria-live="polite" style={compact ? { fontSize: 20, minWidth: 84 } : undefined}>
        {formatDuration(duration)}
      </output>
      <button type="button" aria-label="15 minutes more" onClick={() => setDuration(duration + 15)} disabled={!availability || duration >= availability.length.maxMinutes}>
        <Plus size={16} strokeWidth={1.5} />
      </button>
    </div>
  );

  // --- Selection ---
  const selectedStart = selected ? new Date(selected) : null;
  const selectedEnd = selectedStart ? new Date(selectedStart.getTime() + duration * 60_000) : null;
  const selectedDay = selectedStart ? formatDay(selectedStart) : "—";
  const selectedRange = selectedStart && selectedEnd ? `${formatTime(selectedStart)} → ${formatTime(selectedEnd)}` : "";

  function jumpToEarliest() {
    const slot = earliest();
    if (slot) {
      setSelected(slot.start.toISOString());
      setFlash("");
    } else {
      setFlash("No free time fits this length in the next two weeks.");
    }
  }

  async function submit() {
    if (!upload || !selected) return;
    setBusy("submitting");
    setSubmitError("");
    try {
      const response = await fetch("/api/printq/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          uploadId: upload.id,
          start: selected,
          durationMinutes: duration,
          title: name.trim() || undefined,
          purpose,
          notes: notes.trim() || undefined,
          acceptedRules: true,
        }),
      });
      if (!response.ok) {
        const { code, message } = await readError(response);
        if (code === "slot_unavailable") {
          await loadAvailability(upload.id).catch(() => null);
          setSelected(null);
          setFlash(message);
          setStep("time");
          return;
        }
        setSubmitError(message);
        return;
      }
      setStep("done");
      window.scrollTo(0, 0);
    } finally {
      setBusy(null);
    }
  }

  const go = (next: Step) => {
    setStep(next);
    setFlash("");
    window.scrollTo(0, 0);
  };
  const stepIndex = STEPS.findIndex((item) => item.id === step);
  const grams = upload?.summary.filamentGrams ? `${Math.round(upload.summary.filamentGrams)} g` : "—";
  const material = upload?.summary.filamentType ?? "";
  const lengthCopy = availability?.mustFinishInLabHours
    ? "Prints must start and finish inside lab hours. Starts snap to 15 minutes."
    : "Prints must start inside lab hours. Starts snap to 15 minutes.";

  return (
    <>
      {step !== "done" ? <Stepper index={stepIndex} onBack={stepIndex === 0 ? null : () => go(STEPS[stepIndex - 1].id)} /> : null}

      {step === "upload" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <h2>Upload your sliced file</h2>
            <p className="pq-soft" style={{ textWrap: "pretty" }}>
              We read the print time from your file and hold that much time on the calendar, plus a small safety margin. You can adjust it if you need a buffer.
            </p>
          </div>
          <div className="pq-split">
            <div className="flex min-w-0 flex-col gap-5">
              {!upload ? (
                <>
                  <button
                    type="button"
                    className={`pq-drop${dragOver ? " is-over" : ""}${uploadError ? " is-error" : ""}`}
                    onClick={() => fileInput.current?.click()}
                    onDragOver={(event: DragEvent) => {
                      event.preventDefault();
                      setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(event: DragEvent) => {
                      event.preventDefault();
                      setDragOver(false);
                      void handleFile(event.dataTransfer.files[0]);
                    }}
                    aria-busy={busy !== null}
                  >
                    {busy ? (
                      <Loader2 size={32} strokeWidth={1.5} className="pq-spin" style={{ color: "var(--color-accent-400)" }} aria-hidden />
                    ) : uploadError ? (
                      <AlertCircle size={32} strokeWidth={1.5} style={{ color: "var(--color-conflict-text)" }} aria-hidden />
                    ) : (
                      <Upload size={32} strokeWidth={1.5} style={{ color: "var(--color-accent-400)" }} aria-hidden />
                    )}
                    <span className="pq-heading" style={{ fontSize: 24 }}>
                      {busy === "uploading"
                        ? "Uploading…"
                        : busy === "reading"
                          ? "Reading file…"
                          : uploadError
                            ? uploadError.title
                            : dragOver
                              ? "Drop to upload"
                              : "Drop your .bgcode here or click to browse"}
                    </span>
                    <span className={uploadError ? "pq-note-error text-sm" : "pq-muted text-sm"}>
                      {uploadError ? uploadError.body : `.gcode or .bgcode · PrusaSlicer ${printer.model} profile · max 50 MB`}
                    </span>
                  </button>
                  <input
                    ref={fileInput}
                    type="file"
                    accept={ACCEPTED_EXTENSIONS.join(",")}
                    className="sr-only"
                    tabIndex={-1}
                    onChange={(event) => {
                      void handleFile(event.target.files?.[0]);
                      event.target.value = "";
                    }}
                  />
                </>
              ) : (
                <>
                  <div className="pq-file">
                    <div className="pq-thumb">
                      {upload.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={upload.thumbnailUrl} alt={`Preview of ${upload.originalName}`} />
                      ) : (
                        <span className="pq-muted text-xs">No preview in file</span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-col">
                      <div className="pq-rule-b flex items-center gap-2.5 px-4 py-3">
                        <FileCode2 size={18} strokeWidth={1.5} className="pq-muted shrink-0" aria-hidden />
                        <span className="pq-truncate mr-auto text-sm">{upload.originalName}</span>
                        <button type="button" className="btn btn-ghost" onClick={clearFile}>
                          Replace
                        </button>
                      </div>
                      <div className="pq-meta">
                        {[
                          ["Print time", formatDuration(fileMinutes)],
                          ["Filament", `${grams} ${material}`.trim()],
                          ["Layer height", upload.summary.layerHeightMm ? `${upload.summary.layerHeightMm.toFixed(2)} mm` : "—"],
                          ["Nozzle", upload.summary.nozzleDiameterMm ? `${upload.summary.nozzleDiameterMm} mm` : "—"],
                        ].map(([label, value]) => (
                          <div key={label}>
                            <div className="pq-label">{label}</div>
                            <div className="pq-value">{value}</div>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2 px-4 py-2 text-[13px]" style={{ color: "var(--color-accent-400)" }}>
                        <CheckCircle2 size={14} strokeWidth={1.5} aria-hidden />
                        Sliced for Prusa {printer.model}
                        {fitsBuildVolume(upload.summary.bbox, printer) ? " · fits build volume" : ""}
                      </div>
                    </div>
                  </div>
                  <div className="pq-panel flex flex-col gap-3 p-4">
                    <div className="flex items-center gap-3">
                      <Timer size={18} strokeWidth={1.5} style={{ color: "var(--color-accent-400)" }} aria-hidden />
                      <span className="mr-auto flex flex-col gap-0.5">
                        <span className="pq-label">Time to book</span>
                        <span className={`text-[13px] ${noteClass}`}>{durationNote}</span>
                      </span>
                      {!editingDuration ? (
                        <>
                          <span className="pq-value" style={{ fontSize: 26 }}>
                            {formatDuration(duration)}
                          </span>
                          <button type="button" className="btn btn-secondary" onClick={() => setEditingDuration(true)}>
                            <Pencil size={13} strokeWidth={1.5} aria-hidden />
                            Adjust
                          </button>
                        </>
                      ) : null}
                    </div>
                    {editingDuration ? (
                      <div className="flex flex-wrap items-center gap-3">
                        {stepper()}
                        {edited ? (
                          <button type="button" className="btn btn-ghost" onClick={() => setDuration(defaultMinutes)}>
                            <RotateCcw size={13} strokeWidth={1.5} aria-hidden />
                            Use recommended length
                          </button>
                        ) : null}
                        <button type="button" className="btn btn-ghost ml-auto" onClick={() => setEditingDuration(false)}>
                          Done
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              )}
            </div>
            <div className="flex flex-col gap-[18px]">
              <div className="field">
                <label htmlFor="pq-name">Print name</label>
                <input id="pq-name" className="input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="e.g. Wall bracket v3" />
              </div>
              <div className="field">
                <span style={{ fontSize: 12, color: "var(--color-neutral-300)" }} id="pq-purpose">
                  Purpose
                </span>
                <div className="seg" role="radiogroup" aria-labelledby="pq-purpose">
                  {PURPOSES.map((item) => (
                    <label key={item.id} className="seg-opt">
                      <input type="radio" name="purpose" checked={purpose === item.id} onChange={() => setPurpose(item.id)} />
                      {item.label}
                    </label>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="pq-notes">
                  Notes for staff <span className="pq-muted">(optional)</span>
                </label>
                <textarea id="pq-notes" className="input" rows={3} maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="e.g. Please leave the brim on" />
              </div>
              <button type="button" className="btn btn-primary btn-lg pq-cta self-start" disabled={!upload || !availability} onClick={() => go("time")}>
                Choose a time
                <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          </div>
        </>
      ) : null}

      {step === "time" && availability && upload ? (
        <>
          <div className="flex flex-col gap-1.5">
            <h2>Choose a start time</h2>
            <p className="pq-soft">
              <span className="pq-desk-only">Your print needs {formatDuration(duration)}. Hover the calendar to preview it, click to place it.</span>
              <span className="pq-mob-only">Your print needs {formatDuration(duration)}. Pick a day, then tap a start time.</span>
            </p>
          </div>
          <div className="pq-panel pq-mob-only flex items-center gap-3 px-3 py-2.5">
            <span className="mr-auto flex min-w-0 flex-col gap-0.5">
              <span className="pq-label">Time to book</span>
              <span className={`text-xs ${noteClass}`}>{durationNoteShort}</span>
            </span>
            {stepper(true)}
          </div>
          <div className="pq-pick">
            <WeekCalendar
              data={availability.calendar}
              kicker={`${printer.name} · Pacific time`}
              pick={{
                durationMinutes: duration,
                stepMinutes: availability.stepMinutes,
                selectedStart: selected,
                check: (start) => problemAt(start),
                onSelect: (start) => {
                  setSelected(start);
                  setFlash("");
                },
                onReject: setFlash,
              }}
            />
            <aside className="pq-sticky pq-desk-only flex flex-col gap-4">
              <div className="pq-panel flex flex-col">
                <div className="pq-rule-b flex flex-col gap-0.5 px-4 py-3.5">
                  <span className="pq-label">Your print</span>
                  <span className="pq-heading pq-truncate" style={{ fontSize: 22 }}>
                    {name || upload.originalName}
                  </span>
                  <span className="pq-muted text-[13px]">
                    {grams} {material} · file estimate {formatDuration(fileMinutes)}
                  </span>
                </div>
                <div className="pq-rule-b flex flex-col gap-2.5 px-4 py-3.5">
                  <span className="pq-label">Time to book</span>
                  {stepper()}
                  <div className="flex min-h-6 items-center gap-2">
                    <span className={`mr-auto text-[13px] ${noteClass}`}>{durationNoteShort}</span>
                    {edited ? (
                      <button type="button" className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setDuration(defaultMinutes)}>
                        <RotateCcw size={12} strokeWidth={1.5} aria-hidden />
                        Reset
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="flex min-h-24 flex-col gap-1 p-4">
                  <span className="pq-label">Selected time</span>
                  {selectedStart ? (
                    <>
                      <span className="pq-heading" style={{ fontSize: 28, lineHeight: 1.05 }}>
                        {selectedDay}
                      </span>
                      <span className="pq-soft pq-num">{selectedRange}</span>
                    </>
                  ) : (
                    <span className="pq-muted text-sm">Nothing yet. Click inside a green lab-hours band.</span>
                  )}
                </div>
                {flash ? (
                  <div className="pq-rule-t pq-note-error flex items-center gap-2 px-4 py-2.5 text-[13px]" role="alert">
                    <AlertCircle size={14} strokeWidth={1.5} aria-hidden />
                    {flash}
                  </div>
                ) : null}
                <div className="pq-rule-t flex flex-col gap-2 p-4">
                  <button type="button" className="btn btn-primary btn-md btn-block" disabled={!selected} onClick={() => go("review")}>
                    Continue
                    <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
                  </button>
                  <button type="button" className="btn btn-secondary btn-block" onClick={jumpToEarliest}>
                    <FastForward size={15} strokeWidth={1.5} aria-hidden />
                    Jump to earliest free slot
                  </button>
                </div>
              </div>
              <span className="pq-muted text-[13px]">{lengthCopy}</span>
            </aside>
          </div>
          <div className="pq-sheet pq-mob-only flex flex-col">
            {flash ? (
              <div className="pq-rule-b pq-note-error flex items-center gap-2 px-4 py-2 text-[13px]" role="alert">
                <AlertCircle size={14} strokeWidth={1.5} aria-hidden />
                {flash}
              </div>
            ) : null}
            <div className="flex items-center gap-3 px-4 py-3">
              <span className="mr-auto flex min-w-0 flex-col gap-0.5">
                {selectedStart ? (
                  <>
                    <span className="pq-heading" style={{ fontSize: 20, lineHeight: 1.05 }}>
                      {selectedDay}
                    </span>
                    <span className="pq-soft pq-num text-[13px]">{selectedRange}</span>
                  </>
                ) : (
                  <>
                    <span className="pq-muted text-sm">Tap a green slot to place it</span>
                    <button type="button" className="btn btn-ghost self-start" style={{ padding: 0, fontSize: 13 }} onClick={jumpToEarliest}>
                      <FastForward size={13} strokeWidth={1.5} aria-hidden />
                      Earliest free slot
                    </button>
                  </>
                )}
              </span>
              <button type="button" className="btn btn-primary btn-lg" disabled={!selected} onClick={() => go("review")}>
                Continue
                <ArrowRight size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          </div>
        </>
      ) : null}

      {step === "review" && upload && selectedStart ? (
        <>
          <div className="flex flex-col gap-1.5">
            <h2>Review and submit</h2>
            <p className="pq-soft">Staff approve requests within a few hours during lab time.</p>
          </div>
          <div className="pq-split">
            <div className="pq-panel flex flex-col">
              {(
                [
                  ["Printer", `${printer.name} · D224`],
                  ["File", upload.originalName],
                  ["Print", name.trim() || upload.originalName],
                  ["Purpose", PURPOSES.find((item) => item.id === purpose)?.label ?? ""],
                  ["Length", `${formatDuration(duration)}${edited ? " (edited)" : ""} · ${grams} ${material}`.trim(), true],
                  ["Slot", `${selectedDay}, ${selectedRange}`, true],
                ] as [string, string, boolean?][]
              ).map(([label, value, changeable]) => (
                <div key={label} className="pq-summary-row">
                  <div className="pq-summary-kv">
                    <span className="pq-label" style={{ fontSize: 12 }}>
                      {label}
                    </span>
                    <span className="pq-value pq-truncate">{value}</span>
                  </div>
                  {changeable ? (
                    <button type="button" className="btn btn-ghost" onClick={() => go("time")}>
                      Change
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-[18px]">
              <label className="grid cursor-pointer items-start gap-3 text-[15px] leading-[1.45]" style={{ gridTemplateColumns: "20px minmax(0, 1fr)" }}>
                <input type="checkbox" className="pq-check" checked={agreed} onChange={() => setAgreed(!agreed)} />
                <span>
                  I&apos;ve read the{" "}
                  <Link href="/printing/rules" target="_blank">
                    printing rules
                  </Link>
                  . I&apos;ll be in D224 to start the print and collect it the same day.
                </span>
              </label>
              <button type="button" className="btn btn-primary btn-lg pq-cta self-start" disabled={!agreed || busy === "submitting"} onClick={submit}>
                {busy === "submitting" ? (
                  <Loader2 size={17} strokeWidth={1.5} className="pq-spin" aria-hidden />
                ) : (
                  <Send size={17} strokeWidth={1.5} aria-hidden />
                )}
                Submit request
              </button>
              {submitError ? (
                <span className="pq-note-error flex items-center gap-2 text-[13px]" role="alert">
                  <AlertCircle size={14} strokeWidth={1.5} aria-hidden />
                  {submitError}
                </span>
              ) : null}
              <span className="pq-muted text-[13px]">Your slot shows as “Pending” on the public schedule until it&apos;s approved.</span>
            </div>
          </div>
        </>
      ) : null}

      {step === "done" && selectedStart ? (
        <div className="flex justify-center py-10 max-[759px]:py-2">
          <div className="pq-panel flex w-full max-w-[560px] flex-col">
            <div className="flex flex-col gap-3 p-8 max-[759px]:p-6">
              <span
                className="flex size-12 items-center justify-center"
                style={{ border: "1px solid var(--color-accent-400)", color: "var(--color-accent-400)" }}
              >
                <Check size={26} strokeWidth={1.5} aria-hidden />
              </span>
              <h2>Request sent</h2>
              <p className="pq-soft text-base" style={{ textWrap: "pretty" }}>
                {name.trim() || upload?.originalName} is pending approval for{" "}
                <strong className="font-medium" style={{ color: "var(--color-text)" }}>
                  {selectedDay}, {selectedRange}
                </strong>
                . We&apos;ll DM you on Discord as soon as staff review it.
              </p>
            </div>
            <div className="pq-rule-t flex items-center gap-2.5 px-8 py-3.5 text-sm max-[759px]:px-6" style={{ color: "var(--color-discord-text)" }}>
              <SiDiscord size={16} aria-hidden />
              DMs come from the CSA bot · allow DMs from server members
            </div>
            <div className="pq-rule-t flex flex-wrap gap-3 px-8 py-5 max-[759px]:px-6">
              <Link href="/printing/me" className="btn btn-primary btn-md pq-cta">
                View my prints
              </Link>
              <Link href="/printing" className="btn btn-secondary btn-md pq-cta">
                Back to schedule
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function Stepper({ index, onBack }: { index: number; onBack: (() => void) | null }) {
  return (
    <>
      <div className="pq-desk-only flex items-center gap-5">
        {onBack ? (
          <button type="button" className="btn btn-ghost" style={{ paddingLeft: 0 }} onClick={onBack}>
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
            Back
          </button>
        ) : (
          <Link href="/printing" className="btn btn-ghost" style={{ paddingLeft: 0 }}>
            <ArrowLeft size={16} strokeWidth={1.5} aria-hidden />
            Back
          </Link>
        )}
        <ol className="pq-steps" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {STEPS.map((item, i) => (
            <li key={item.id} className={`pq-step${i === index ? " is-current" : ""}${i < index ? " is-done" : ""}`} aria-current={i === index ? "step" : undefined}>
              <span className="pq-value">{`0${i + 1}`}</span>
              <span className="pq-truncate text-sm">{item.label}</span>
              {i < index ? <Check size={16} strokeWidth={1.5} className="ml-auto shrink-0" style={{ color: "var(--color-accent-400)" }} aria-hidden /> : null}
            </li>
          ))}
        </ol>
      </div>
      <div className="pq-mob-only flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          {onBack ? (
            <button type="button" className="btn btn-icon" aria-label="Back" onClick={onBack}>
              <ArrowLeft size={18} strokeWidth={1.5} />
            </button>
          ) : (
            <Link href="/printing" className="btn btn-icon" aria-label="Back">
              <ArrowLeft size={18} strokeWidth={1.5} />
            </Link>
          )}
          <span className="pq-label" style={{ fontSize: 12 }}>
            Step {index + 1} of 3
          </span>
          <span className="ml-auto text-sm">{STEPS[index]?.label}</span>
        </div>
        <div className="pq-step-bars">
          {STEPS.map((item, i) => (
            <span key={item.id} className={i <= index ? "is-on" : ""} />
          ))}
        </div>
      </div>
    </>
  );
}
