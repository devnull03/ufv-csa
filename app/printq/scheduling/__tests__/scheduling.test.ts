import { describe, expect, it } from "vitest";
import { PRINTQ_TIMEZONE as TZ } from "../../constants";
import { mergeIntervals, subtractIntervals } from "../intervals";
import { availableStarts, bookedDurationMinutes, labWindows, type WeeklyHours } from "../slots";
import { allowedActions, canTransition, InvalidTransitionError, nextStatus } from "../state-machine";
import { fromLocal, toLocal } from "../time";

const at = (iso: string) => new Date(iso);
const iso = (date: Date) => date.toISOString();

describe("time helpers", () => {
  it("converts Vancouver wall-clock time across the 2026 DST change", () => {
    // DST ends Sunday 2026-11-01: PDT (UTC-7) before, PST (UTC-8) after.
    expect(iso(fromLocal({ year: 2026, month: 10, day: 30, hour: 9, minute: 0 }, TZ))).toBe("2026-10-30T16:00:00.000Z");
    expect(iso(fromLocal({ year: 2026, month: 11, day: 2, hour: 9, minute: 0 }, TZ))).toBe("2026-11-02T17:00:00.000Z");
  });

  it("round-trips an instant to local time", () => {
    expect(toLocal(at("2026-11-02T17:30:00Z"), TZ)).toMatchObject({ year: 2026, month: 11, day: 2, hour: 9, minute: 30 });
  });
});

describe("intervals", () => {
  it("merges overlapping and touching intervals", () => {
    const merged = mergeIntervals([
      { start: at("2026-01-01T10:00Z"), end: at("2026-01-01T11:00Z") },
      { start: at("2026-01-01T11:00Z"), end: at("2026-01-01T12:00Z") },
      { start: at("2026-01-01T09:00Z"), end: at("2026-01-01T10:30Z") },
    ]);
    expect(merged.map((i) => [iso(i.start), iso(i.end)])).toEqual([["2026-01-01T09:00:00.000Z", "2026-01-01T12:00:00.000Z"]]);
  });

  it("subtracts a cut from the middle of an interval", () => {
    const result = subtractIntervals(
      [{ start: at("2026-01-01T09:00Z"), end: at("2026-01-01T17:00Z") }],
      [{ start: at("2026-01-01T12:00Z"), end: at("2026-01-01T13:00Z") }]
    );
    expect(result.map((i) => [iso(i.start), iso(i.end)])).toEqual([
      ["2026-01-01T09:00:00.000Z", "2026-01-01T12:00:00.000Z"],
      ["2026-01-01T13:00:00.000Z", "2026-01-01T17:00:00.000Z"],
    ]);
  });
});

const weekdays10to4: WeeklyHours[] = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: "10:00", closesAt: "16:00" }));

describe("labWindows", () => {
  it("expands weekly hours into windows and skips weekends", () => {
    // Fri 2026-10-30 to Tue 2026-11-03 (local)
    const windows = labWindows(
      { start: at("2026-10-30T07:00Z"), end: at("2026-11-04T08:00Z") },
      weekdays10to4,
      [],
      TZ
    );
    expect(windows.map((w) => iso(w.start))).toEqual([
      "2026-10-30T17:00:00.000Z", // Fri 10:00 PDT
      "2026-11-02T18:00:00.000Z", // Mon 10:00 PST
      "2026-11-03T18:00:00.000Z", // Tue 10:00 PST
    ]);
  });

  it("removes closures", () => {
    const windows = labWindows(
      { start: at("2026-11-02T08:00Z"), end: at("2026-11-03T08:00Z") },
      weekdays10to4,
      [{ start: at("2026-11-02T20:00Z"), end: at("2026-11-02T21:00Z") }],
      TZ
    );
    expect(windows.map((w) => [iso(w.start), iso(w.end)])).toEqual([
      ["2026-11-02T18:00:00.000Z", "2026-11-02T20:00:00.000Z"],
      ["2026-11-02T21:00:00.000Z", "2026-11-03T00:00:00.000Z"],
    ]);
  });

  it("clips to the requested range", () => {
    const windows = labWindows(
      { start: at("2026-11-02T19:00Z"), end: at("2026-11-02T22:00Z") },
      weekdays10to4,
      [],
      TZ
    );
    expect(windows.map((w) => [iso(w.start), iso(w.end)])).toEqual([["2026-11-02T19:00:00.000Z", "2026-11-02T22:00:00.000Z"]]);
  });
});

describe("bookedDurationMinutes", () => {
  it("adds padding and buffer and rounds up to the slot step", () => {
    // 100 min * 1.1 = 110 + 15 = 125 -> 135
    expect(bookedDurationMinutes(6000, { paddingPct: 10, bufferMinutes: 15 }, 15)).toBe(135);
  });

  it("rejects non-positive estimates", () => {
    expect(() => bookedDurationMinutes(0, { paddingPct: 10, bufferMinutes: 15 }, 15)).toThrow();
  });
});

describe("availableStarts", () => {
  const window = { start: at("2026-11-02T18:00Z"), end: at("2026-11-03T00:00Z") }; // Mon 10:00-16:00 PST

  it("offers starts every step inside the window, skipping busy time", () => {
    const slots = availableStarts({
      windows: [window],
      busy: [{ start: at("2026-11-02T19:00Z"), end: at("2026-11-02T21:00Z") }],
      durationMinutes: 60,
      stepMinutes: 30,
      earliestStart: at("2026-11-01T00:00Z"),
      mustFinishInLabHours: true,
    });
    expect(slots.map((s) => iso(s.start))).toEqual([
      "2026-11-02T18:00:00.000Z",
      "2026-11-02T21:00:00.000Z",
      "2026-11-02T21:30:00.000Z",
      "2026-11-02T22:00:00.000Z",
      "2026-11-02T22:30:00.000Z",
      "2026-11-02T23:00:00.000Z",
    ]);
  });

  it("allows prints to run past close when policy permits", () => {
    const slots = availableStarts({
      windows: [window],
      busy: [],
      durationMinutes: 600,
      stepMinutes: 60,
      earliestStart: at("2026-11-01T00:00Z"),
      mustFinishInLabHours: false,
    });
    expect(slots).toHaveLength(6);
    expect(slots.every((s) => s.runsPastClose)).toBe(true);
  });

  it("returns nothing when a long print must finish in lab hours", () => {
    const slots = availableStarts({
      windows: [window],
      busy: [],
      durationMinutes: 600,
      stepMinutes: 60,
      earliestStart: at("2026-11-01T00:00Z"),
      mustFinishInLabHours: true,
    });
    expect(slots).toEqual([]);
  });

  it("respects the earliest start and aligns to the step", () => {
    const slots = availableStarts({
      windows: [window],
      busy: [],
      durationMinutes: 15,
      stepMinutes: 15,
      earliestStart: at("2026-11-02T23:31Z"),
      mustFinishInLabHours: true,
    });
    expect(slots.map((s) => iso(s.start))).toEqual(["2026-11-02T23:45:00.000Z"]);
  });

  it("blocks a start whose print would overlap a later booking", () => {
    const slots = availableStarts({
      windows: [window],
      busy: [{ start: at("2026-11-02T20:00Z"), end: at("2026-11-02T21:00Z") }],
      durationMinutes: 120,
      stepMinutes: 60,
      earliestStart: at("2026-11-01T00:00Z"),
      mustFinishInLabHours: false,
    });
    // 18:00 ends exactly when the booking starts (half-open ranges); 19:00 would overlap it.
    expect(slots.map((s) => iso(s.start))).toEqual([
      "2026-11-02T18:00:00.000Z",
      "2026-11-02T21:00:00.000Z",
      "2026-11-02T22:00:00.000Z",
      "2026-11-02T23:00:00.000Z",
    ]);
  });
});

describe("state machine", () => {
  it("lets staff approve and owners cancel pending bookings", () => {
    expect(nextStatus("pending", "approve", "staff")).toBe("approved");
    expect(nextStatus("pending", "cancel", "owner")).toBe("cancelled");
  });

  it("forbids owners from approving and anyone from leaving terminal states", () => {
    expect(() => nextStatus("pending", "approve", "owner")).toThrow(InvalidTransitionError);
    expect(canTransition("collected", "approved", "staff")).toBe(false);
  });

  it("only lets the system expire holds", () => {
    expect(canTransition("pending", "expired", "system")).toBe(true);
    expect(canTransition("pending", "expired", "staff")).toBe(false);
  });

  it("lists the actions staff can take during a session", () => {
    expect(allowedActions("approved", "staff")).toEqual(["cancel", "check_in", "no_show", "lab_closed"]);
    expect(allowedActions("printing", "staff")).toEqual(["finish", "fail"]);
  });
});
