import { describe, expect, it } from "vitest";
import { PRINTQ_TIMEZONE as TZ } from "../../constants";
import { isFreshTimestamp } from "../../discord/freshness";
import { hoursSummary } from "../../discord/render";
import { toLocal } from "../time";
import { parseStart, parseTimeRange, parseWhen, WhenParseError } from "../when";

// Monday 2026-10-05, 9:00 AM in Vancouver.
const now = new Date("2026-10-05T16:00:00Z");
const local = (date: Date) => {
  const { year, month, day, hour, minute } = toLocal(date, TZ);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};
const range = (text: string) => {
  const parsed = parseWhen(text, now, TZ);
  return `${local(parsed.start)} → ${local(parsed.end)}${parsed.allDay ? " (all day)" : ""}`;
};

describe("parseTimeRange", () => {
  it.each([
    ["10:00-18:00", [600, 1080]],
    ["10am-6pm", [600, 1080]],
    ["2-4pm", [840, 960]],
    ["10-4pm", [600, 960]],
    ["10-4", [600, 960]],
    ["12:30 to 4pm", [750, 960]],
    ["9:00–24:00", [540, 1440]],
  ])("%s", (text, [start, end]) => {
    expect(parseTimeRange(text)).toEqual({ start, end });
  });

  it("rejects backwards and malformed ranges", () => {
    expect(parseTimeRange("4pm-2pm")).toBeNull();
    expect(parseTimeRange("noon-ish")).toBeNull();
  });
});

describe("parseWhen", () => {
  it("reads the phrases staff type", () => {
    expect(range("today 2pm-3pm")).toBe("2026-10-05 14:00 → 2026-10-05 15:00");
    expect(range("tomorrow all day")).toBe("2026-10-06 00:00 → 2026-10-07 00:00 (all day)");
    expect(range("Fri 12:30-4pm")).toBe("2026-10-09 12:30 → 2026-10-09 16:00");
    expect(range("friday 12:30-16:00")).toBe("2026-10-09 12:30 → 2026-10-09 16:00");
    expect(range("Oct 9")).toBe("2026-10-09 00:00 → 2026-10-10 00:00 (all day)");
    expect(range("9 October 10-12")).toBe("2026-10-09 10:00 → 2026-10-09 12:00");
    expect(range("2026-10-09 10:00-12:00")).toBe("2026-10-09 10:00 → 2026-10-09 12:00");
    expect(range("10/9 1pm-2pm")).toBe("2026-10-09 13:00 → 2026-10-09 14:00");
  });

  it("treats today's weekday as today, and 'next' as a week later", () => {
    expect(range("mon 10-11")).toBe("2026-10-05 10:00 → 2026-10-05 11:00");
    expect(range("next mon 10-11")).toBe("2026-10-12 10:00 → 2026-10-12 11:00");
  });

  it("rolls dates that already passed into next year", () => {
    expect(range("Jan 3")).toBe("2027-01-03 00:00 → 2027-01-04 00:00 (all day)");
  });

  it("explains what it couldn't read", () => {
    expect(() => parseWhen("someday", now, TZ)).toThrow(WhenParseError);
    expect(() => parseWhen("Fri at lunch", now, TZ)).toThrow(/times/);
    expect(() => parseWhen("Feb 30", now, TZ)).toThrow(/day/);
  });
});

describe("parseStart", () => {
  it("reads a start time", () => {
    expect(local(parseStart("Wed 2pm", now, TZ))).toBe("2026-10-07 14:00");
    expect(local(parseStart("tomorrow 10:30", now, TZ))).toBe("2026-10-06 10:30");
    expect(local(parseStart("3", now, TZ))).toBe("2026-10-05 15:00");
    expect(local(parseStart("Oct 9 at 1pm", now, TZ))).toBe("2026-10-09 13:00");
  });

  it("rejects nonsense", () => {
    expect(() => parseStart("whenever", now, TZ)).toThrow(WhenParseError);
  });
});

describe("board helpers", () => {
  it("summarises weekly hours, grouping identical days", () => {
    const hours = [1, 2, 3, 4].map((weekday) => ({ weekday, opensAt: "10:00:00", closesAt: "18:00:00" }));
    hours.push({ weekday: 5, opensAt: "10:00:00", closesAt: "16:00:00" });
    expect(hoursSummary(hours)).toBe("Mon–Thu 10AM–6PM · Fri 10AM–4PM · Sat–Sun closed");
  });
});

describe("interaction timestamp freshness", () => {
  const nowMs = 1_790_000_000_000;
  it("accepts requests within five minutes and rejects older or malformed ones", () => {
    expect(isFreshTimestamp(String(nowMs / 1000 - 10), nowMs)).toBe(true);
    expect(isFreshTimestamp(String(nowMs / 1000 - 301), nowMs)).toBe(false);
    expect(isFreshTimestamp(String(nowMs / 1000 + 400), nowMs)).toBe(false);
    expect(isFreshTimestamp("", nowMs)).toBe(false);
    expect(isFreshTimestamp("abc", nowMs)).toBe(false);
  });
});
