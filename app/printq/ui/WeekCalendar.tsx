"use client";

import { Box, ChevronLeft, ChevronRight, DoorClosed, Hourglass, Printer, Wrench } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type MouseEvent } from "react";
import type { CalendarData } from "../calendar";
import { buildCalendar, type DayBlock, type DayColumn } from "../calendar-view";
import { formatCompactRange, formatTime } from "../format";
import { fromLocal, toLocal } from "../scheduling/time";

// Spec C08/C09: 48px per hour, blocks inset 1px vertically and 4px horizontally,
// public blocks never show names, ghosts snap to the slot step.
const PX_PER_MINUTE = 48 / 60;

export interface PickOptions {
  durationMinutes: number;
  stepMinutes: number;
  selectedStart: string | null;
  // Reason a start is invalid, or null if it can be placed.
  check: (start: Date) => string | null;
  onSelect: (start: string) => void;
  onReject: (reason: string) => void;
}

export function WeekCalendar({
  data,
  kicker,
  pick,
  showMineLegend = false,
}: {
  data: CalendarData;
  kicker: string;
  pick?: PickOptions;
  showMineLegend?: boolean;
}) {
  const model = useMemo(() => buildCalendar(data), [data]);
  const [week, setWeek] = useState(0);
  const [mobileDay, setMobileDay] = useState(() => initialDay(model.weeks[0]?.days ?? []));
  const [hover, setHover] = useState<{ key: string; minute: number } | null>(null);
  const gridMinutes = (model.hourEnd - model.hourStart) * 60;
  const height = gridMinutes * PX_PER_MINUTE;

  // Follow the selection when it moves (e.g. "Jump to earliest free slot").
  const selectedStart = pick?.selectedStart ?? null;
  useEffect(() => {
    if (!selectedStart) return;
    const at = new Date(selectedStart).getTime();
    model.weeks.forEach((candidate, w) =>
      candidate.days.forEach((day, d) => {
        if (day.start.getTime() <= at && at < day.end.getTime()) {
          setWeek(w);
          setMobileDay(d);
        }
      })
    );
  }, [selectedStart, model]);

  const current = model.weeks[week];
  if (!current) return null;

  const minuteAt = (event: MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const step = pick?.stepMinutes ?? 15;
    const raw = (event.clientY - rect.top) / PX_PER_MINUTE;
    return Math.max(0, Math.min(gridMinutes - step, Math.round(raw / step) * step));
  };
  const startAt = (day: DayColumn, minute: number) => {
    const total = model.hourStart * 60 + minute;
    return fromLocal({ ...day.date, hour: Math.floor(total / 60), minute: total % 60 }, data.timeZone);
  };
  const place = (day: DayColumn, minute: number) => {
    if (!pick) return;
    const start = startAt(day, minute);
    const reason = pick.check(start);
    if (reason) pick.onReject(reason);
    else pick.onSelect(start.toISOString());
  };

  const selected = pick?.selectedStart ? new Date(pick.selectedStart) : null;
  const selectionFor = (day: DayColumn) => {
    if (!selected || !pick || selected < day.start || selected >= day.end) return null;
    const local = toLocal(selected, data.timeZone);
    const top = Math.max(0, local.hour * 60 + local.minute - model.hourStart * 60);
    return { top, height: pick.durationMinutes, range: formatCompactRange(selected, new Date(selected.getTime() + pick.durationMinutes * 60_000)) };
  };

  const renderDay = (day: DayColumn, interactive: boolean) => {
    const selection = selectionFor(day);
    const ghostMinute = interactive && hover?.key === day.key ? hover.minute : null;
    let ghost: { top: number; label: string; reason: string | null } | null = null;
    if (pick && ghostMinute !== null) {
      const start = startAt(day, ghostMinute);
      if (!selected || start.getTime() !== selected.getTime()) {
        ghost = {
          top: ghostMinute,
          label: formatCompactRange(start, new Date(start.getTime() + pick.durationMinutes * 60_000)),
          reason: pick.check(start),
        };
      }
    }
    return (
      <div
        key={day.key}
        className={`pq-cal-day${pick ? " is-pick" : ""}`}
        style={{ height }}
        onMouseMove={
          pick && interactive
            ? (event) => {
                const minute = minuteAt(event);
                if (hover?.key !== day.key || hover.minute !== minute) setHover({ key: day.key, minute });
              }
            : undefined
        }
        onMouseLeave={pick && interactive ? () => setHover(null) : undefined}
        onClick={pick ? (event) => place(day, minuteAt(event)) : undefined}
        role={pick ? "button" : undefined}
        aria-label={pick ? `${day.dow} ${day.dayNumber}: choose a start time` : undefined}
      >
        {day.closedLabel !== null ? (
          <div className="pq-cal-closed">
            <span>{day.closedLabel}</span>
          </div>
        ) : null}
        {day.windows.map((window) => (
          <div key={window.top} className="pq-cal-band" style={position(window.top, window.height)} />
        ))}
        {day.blocks.map((block) => (
          <Block key={`${block.kind}-${block.start}`} block={block} inPicker={!!pick} />
        ))}
        {selection ? (
          <div className="pq-block is-mine" style={position(selection.top, selection.height)}>
            <span className="pq-block-title">
              <Box size={13} strokeWidth={1.5} aria-hidden />
              Your print
            </span>
            <span className="pq-block-range">{selection.range}</span>
          </div>
        ) : null}
        {pick && day.pastUntil ? <div className="pq-cal-past" style={{ height: day.pastUntil * PX_PER_MINUTE }} /> : null}
        {ghost ? (
          <div
            className={`pq-block is-ghost ${ghost.reason ? "is-ghost-bad" : "is-ghost-ok"}`}
            style={position(ghost.top, pick!.durationMinutes)}
          >
            <span className="pq-block-range" style={{ fontSize: 12, fontWeight: 600 }}>
              {ghost.label}
            </span>
            <span className="pq-block-range">{ghost.reason ?? "Click to place"}</span>
          </div>
        ) : null}
        {day.isToday && model.nowTop !== null ? (
          <div className="pq-cal-now" style={{ top: model.nowTop * PX_PER_MINUTE }}>
            <span>{formatTime(data.now)}</span>
          </div>
        ) : null}
      </div>
    );
  };

  const hours = Array.from({ length: model.hourEnd - model.hourStart }, (_, i) => model.hourStart + i);
  const gutter = (
    <div className="pq-cal-gutter" style={{ height }}>
      {hours.map((hour, i) => (
        <div key={hour} className="pq-cal-hour" style={{ top: i * 48 }}>
          {i > 0 ? <span>{`${hour % 12 || 12} ${hour >= 12 ? "PM" : "AM"}`}</span> : null}
        </div>
      ))}
    </div>
  );

  const dayHasStart = (day: DayColumn) => {
    if (day.windows.length === 0) return false;
    if (!pick) return true;
    for (let minute = 0; minute < gridMinutes; minute += pick.stepMinutes) {
      if (!pick.check(startAt(day, minute))) return true;
    }
    return false;
  };
  const mobile = current.days[mobileDay] ?? current.days[0];

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex items-end gap-4">
        <div className="mr-auto flex min-w-0 flex-col gap-0.5">
          <h6>{kicker}</h6>
          <h3>{current.label}</h3>
        </div>
        <div className="flex">
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Previous week"
            disabled={week === 0}
            onClick={() => {
              setWeek(week - 1);
              setMobileDay(0);
              setHover(null);
            }}
          >
            <ChevronLeft size={18} strokeWidth={1.5} />
          </button>
          <button
            type="button"
            className="btn pq-desk-only"
            style={{ borderLeft: 0, borderRight: 0 }}
            onClick={() => {
              setWeek(0);
              setMobileDay(initialDay(model.weeks[0].days));
              setHover(null);
            }}
          >
            This week
          </button>
          <button
            type="button"
            className="btn btn-icon"
            aria-label="Next week"
            disabled={week === model.weeks.length - 1}
            onClick={() => {
              setWeek(week + 1);
              setMobileDay(0);
              setHover(null);
            }}
          >
            <ChevronRight size={18} strokeWidth={1.5} />
          </button>
        </div>
      </div>

      {/* Desktop: hour gutter + 7 day columns (scrolls sideways when narrow) */}
      <div className="pq-cal-scroll pq-desk-only">
        <div className="pq-cal" style={{ gridTemplateColumns: "56px repeat(7, minmax(0, 1fr))", minWidth: 760 }}>
          <div className="pq-rule-b" />
          {current.days.map((day) => (
            <div
              key={day.key}
              className={`pq-cal-head${day.isToday ? " is-today" : ""}${day.windows.length === 0 ? " is-closed" : ""}`}
            >
              <span className="pq-dow">{day.dow}</span>
              <span className="pq-value">{day.dayNumber}</span>
              {day.isToday ? <span className="pq-today">Today</span> : null}
            </div>
          ))}
          {gutter}
          {current.days.map((day) => renderDay(day, true))}
        </div>
      </div>

      {/* Mobile: day strip + one day column */}
      <div className="pq-mob-only flex flex-col gap-3.5">
        <div className="pq-strip">
          {current.days.map((day, index) => (
            <button
              key={day.key}
              type="button"
              className={`${index === mobileDay ? "is-selected" : ""}${day.windows.length === 0 ? " is-closed" : ""}`}
              onClick={() => setMobileDay(index)}
              aria-pressed={index === mobileDay}
            >
              <span style={{ fontSize: 11, letterSpacing: "0.06em", textTransform: "uppercase" }}>{day.dow}</span>
              <span className="pq-value" style={{ fontSize: 22, lineHeight: 1 }}>
                {day.dayNumber}
              </span>
              <span
                className="pq-dot"
                style={{
                  background: day.isToday ? "var(--color-text)" : dayHasStart(day) ? "var(--color-accent)" : "transparent",
                }}
              />
            </button>
          ))}
        </div>
        <div className="pq-cal" style={{ gridTemplateColumns: "48px minmax(0, 1fr)" }}>
          {gutter}
          {renderDay(mobile, false)}
        </div>
      </div>

      <div className="pq-legend">
        <span>
          <span className="pq-swatch is-open" />
          Lab hours
        </span>
        <span>
          <span className="pq-swatch is-booked" />
          Booked
        </span>
        <span>
          <span className="pq-swatch is-printing" />
          Printing
        </span>
        <span>
          <span className="pq-swatch is-pending" />
          Pending
        </span>
        <span>
          <span className="pq-swatch is-closed" />
          Closed
        </span>
        {pick || showMineLegend ? (
          <span>
            <span className="pq-swatch is-mine" />
            Your print
          </span>
        ) : null}
        <span className="pq-muted pq-desk-only" style={{ marginLeft: "auto" }}>
          Names are never shown publicly.
        </span>
      </div>
    </div>
  );
}

function Block({ block, inPicker }: { block: DayBlock; inPicker: boolean }) {
  const style = position(block.top, block.height);
  const range = <span className="pq-block-range">{formatCompactRange(block.start, block.end)}</span>;
  switch (block.kind) {
    case "booked":
      return (
        <div className="pq-block is-booked" style={style}>
          <span className="pq-block-title">Booked</span>
          {range}
        </div>
      );
    case "printing":
      return (
        <div className="pq-block is-printing" style={style}>
          <span className="pq-block-title">
            <Printer size={13} strokeWidth={1.5} aria-hidden />
            Printing now
          </span>
          {range}
        </div>
      );
    case "pending":
      return (
        <div className="pq-block is-pending" style={style}>
          <span className="pq-block-title">
            <Hourglass size={13} strokeWidth={1.5} aria-hidden />
            Pending
          </span>
          {range}
        </div>
      );
    case "maintenance":
    case "closure": {
      const Icon = block.kind === "maintenance" ? Wrench : DoorClosed;
      return (
        <div className="pq-block is-hatch" style={style}>
          <span className="pq-block-title">
            <Icon size={13} strokeWidth={1.5} aria-hidden />
            {block.label ?? (block.kind === "maintenance" ? "Maintenance" : "Closed")}
          </span>
          {block.height >= 60 ? range : null}
        </div>
      );
    }
    case "mine": {
      const pending = block.status === "pending" || inPicker;
      return (
        <div className={`pq-block ${pending ? "is-mine-pending" : "is-mine"}`} style={style}>
          <span className="pq-block-title">
            <Box size={13} strokeWidth={1.5} aria-hidden />
            {block.status === "pending" ? "Your print · pending" : "Your print"}
          </span>
          {range}
        </div>
      );
    }
  }
}

function position(topMinutes: number, heightMinutes: number): CSSProperties {
  return {
    top: topMinutes * PX_PER_MINUTE + 1,
    height: Math.max(0, heightMinutes * PX_PER_MINUTE - 2),
  };
}

function initialDay(days: DayColumn[]) {
  const today = days.findIndex((day) => day.isToday);
  if (today >= 0) return today;
  const open = days.findIndex((day) => day.windows.length > 0);
  return open >= 0 ? open : 0;
}
