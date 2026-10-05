import { Box, CalendarClock, DoorClosed, Disc3, Layers, Thermometer, Timer } from "lucide-react";
import { PRINTQ_TIMEZONE } from "~/app/printq/constants";
import { busyFrom, nextFreeTime, weekStart } from "~/app/printq/calendar-view";
import { db, schema } from "~/app/printq/db/client";
import { formatClock, formatDay, formatDuration, formatTime, WEEKDAY_NAMES } from "~/app/printq/format";
import { getLabStatus } from "~/app/printq/lab-status";
import { getActivePrinter, getCurrentPrint, getNextClosure, loadCalendar } from "~/app/printq/schedule";
import { getSettings } from "~/app/printq/settings";
import { getPrinterTelemetry } from "~/app/printq/telemetry";
import { PrinterHero } from "~/app/printq/ui/PrinterHero";
import { WeekCalendar } from "~/app/printq/ui/WeekCalendar";
import { getViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

// Screen 01 · Home: printer hero, then the public schedule.
export default async function PrintingPage() {
  const [viewer, labStatus, settings, printer] = await Promise.all([
    getViewer(),
    getLabStatus(),
    getSettings(),
    getActivePrinter().catch(() => null),
  ]);

  if (!printer) {
    return (
      <div className="pq-panel flex flex-col gap-2 p-8">
        <span className="pq-overline">PrintQ</span>
        <h2>Schedule coming soon</h2>
        <p className="pq-soft">No printer has been set up yet. Check back once the lab is ready.</p>
      </div>
    );
  }

  const now = new Date();
  const from = weekStart(now, PRINTQ_TIMEZONE);
  const [calendar, current, nextClosure, hours] = await Promise.all([
    loadCalendar(printer.id, { start: from, end: new Date(from.getTime() + 14 * 86_400_000) }, viewer?.userId),
    getCurrentPrint(printer.id),
    getNextClosure(printer.id),
    db().select().from(schema.labHours),
  ]);

  const todayKey = formatDay(now);
  const windows = calendar.windows.map((window) => ({ start: new Date(window.start), end: new Date(window.end) }));
  const todayWindow = windows.find((window) => formatDay(window.start) === todayKey && window.end > now);
  const nextWindow = windows.find((window) => window.start > now);
  const labText =
    labStatus.open === true
      ? todayWindow
        ? `Lab open until ${formatTime(todayWindow.end)}`
        : "Lab open"
      : labStatus.open === false
        ? nextWindow
          ? `Lab closed · opens ${formatDay(nextWindow.start) === todayKey ? "today" : formatDay(nextWindow.start)} ${formatTime(nextWindow.start)}`
          : "Lab closed"
        : "Lab status unknown";

  const free = nextFreeTime(calendar);
  const nextBusy = current ? null : busyFrom(calendar, now);
  const freeUntil = nextBusy && todayWindow && nextBusy < todayWindow.end ? nextBusy : null;

  const telemetry = getPrinterTelemetry(Boolean(current));
  const stats = [
    { icon: Thermometer, label: "Nozzle", ...telemetry.nozzle },
    { icon: Layers, label: "Bed", ...telemetry.bed },
    { icon: Disc3, label: "Loaded", ...telemetry.loaded },
    {
      icon: CalendarClock,
      label: "Next opening",
      value: free ? `${formatDay(free.at) === todayKey ? "Today" : formatDay(free.at)} ${formatTime(free.at)}` : "None soon",
      sub: free ? `${formatDuration((free.windowEnd.getTime() - free.at.getTime()) / 60_000)} before close` : "Check back later",
    },
    { icon: Box, label: "Build volume", value: `${printer.bedX}×${printer.bedY}×${printer.bedZ}`, sub: "mm" },
    { icon: Timer, label: "Max booking", value: `${settings.maxPrintHours} h`, sub: "Start inside lab hours" },
  ];

  const sortedHours = WEEKDAY_NAMES.map((day, index) => ({
    day,
    ranges: hours
      .filter((row) => row.weekday === index)
      .sort((a, b) => a.opensAt.localeCompare(b.opensAt))
      .map((row) => `${formatClock(row.opensAt)} – ${formatClock(row.closesAt)}`),
  }));
  // Monday first, like the calendar.
  const weekRows = [...sortedHours.slice(1), sortedHours[0]];

  return (
    <>
      <PrinterHero
        printerName={printer.name}
        printerLabel="Printer 01 · Room D224"
        status={current ? "printing" : printer.status === "maintenance" ? "maintenance" : "ready"}
        lab={{ open: labStatus.open, text: labText }}
        job={current ? { ...current, now } : null}
        freeUntil={freeUntil}
        stats={stats}
        bookHref={viewer ? "/printing/new" : "/printing/login?next=/printing/new"}
      />

      <WeekCalendar data={calendar} kicker={`Printer 01 · ${printer.name} · Pacific time`} showMineLegend={!!viewer} />

      <section className="pq-split">
        <div className="flex flex-col gap-3.5">
          <h6>Lab hours</h6>
          <div className="pq-rule-t flex flex-col">
            {weekRows.map((row) => (
              <div
                key={row.day}
                className="grid items-baseline py-[7px]"
                style={{ gridTemplateColumns: "140px minmax(0, 1fr)", borderBottom: "1px solid var(--color-hairline-soft)" }}
              >
                <span className="pq-heading" style={{ fontSize: 18 }}>
                  {row.day}
                </span>
                <span className="pq-num" style={{ color: row.ranges.length ? "var(--color-neutral-200)" : "var(--color-faint)" }}>
                  {row.ranges.length ? row.ranges.join(", ") : "Closed"}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3.5">
          <h6>Next closure</h6>
          {nextClosure ? (
            <div className="pq-panel flex flex-col gap-2.5 p-5">
              <span className="flex items-center gap-2 text-[13px]" style={{ color: "var(--color-closure)" }}>
                <DoorClosed size={16} strokeWidth={1.5} aria-hidden />
                {nextClosure.end.getTime() - nextClosure.start.getTime() >= 20 * 3_600_000
                  ? "Closed all day"
                  : `Closed ${formatTime(nextClosure.start)} – ${formatTime(nextClosure.end)}`}
              </span>
              <span className="pq-heading" style={{ fontSize: 30, lineHeight: 1.05 }}>
                {formatDay(nextClosure.start)}
              </span>
              <span className="pq-soft">{nextClosure.reason}</span>
            </div>
          ) : (
            <div className="pq-panel p-5">
              <span className="pq-soft">No closures scheduled.</span>
            </div>
          )}
          <span className="pq-muted text-[13px]">
            Hours follow the room&apos;s open/closed status in Discord. Check the badge above before you head over.
          </span>
        </div>
      </section>
    </>
  );
}
