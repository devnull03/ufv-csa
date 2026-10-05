import {
  ButtonStyle,
  ComponentType,
  TextInputStyle,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
  type APIMessageActionRowComponent,
  type APIModalInteractionResponseCallbackData,
} from "discord-api-types/v10";
import type { BookingStatus } from "../constants";
import type { CalendarData } from "../calendar";
import type { ParsedGcodeSummary } from "../db/schema";
import { formatCompactRange, formatDay, formatDuration, formatSlot, formatTime, STATUS_LABELS, WEEKDAY_NAMES, formatClock } from "../format";
import { allowedActions, type BookingAction } from "../scheduling/state-machine";
import { WHEN_EXAMPLES } from "../scheduling/when";
import { PRINTQ_CUSTOM_ID_PREFIX } from "./commands";

// Pure renderers for every message the bot sends or edits. `live` is true when
// talking to real Discord (mentions and <t:…> timestamps render there); in demo
// mode we write plain text instead so the preview reads the same.

export type Row = APIActionRowComponent<APIMessageActionRowComponent>;
export interface MessagePayload {
  content?: string;
  embeds: APIEmbed[];
  components: Row[];
}

const BRAND = 0x52a040;
export const STATUS_COLOR: Record<BookingStatus, number> = {
  pending: 0xf5a524,
  approved: 0x52a040,
  checked_in: 0x5865f2,
  printing: 0x5865f2,
  finished: 0x2fb4a8,
  collected: 0x4e5058,
  rejected: 0xf87171,
  failed: 0xf87171,
  cancelled: 0x4e5058,
  expired: 0x4e5058,
  no_show: 0x4e5058,
  lab_closed: 0x4e5058,
};
export const STATUS_EMOJI: Record<BookingStatus, string> = {
  pending: "⏳",
  approved: "✅",
  checked_in: "📍",
  printing: "🖨️",
  finished: "🏁",
  collected: "📦",
  rejected: "❌",
  failed: "⚠️",
  cancelled: "🚫",
  expired: "⌛",
  no_show: "👻",
  lab_closed: "🔒",
};

export const customId = (action: string, id = "board") => `${PRINTQ_CUSTOM_ID_PREFIX}${action}:${id}`;

const button = (
  label: string,
  action: string,
  id: string,
  style: ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger,
  emoji?: string,
  disabled = false
): APIButtonComponent => ({
  type: ComponentType.Button,
  style,
  label,
  custom_id: customId(action, id),
  ...(emoji ? { emoji: { name: emoji } } : {}),
  ...(disabled ? { disabled: true } : {}),
});
const linkButton = (label: string, url: string): APIButtonComponent => ({ type: ComponentType.Button, style: ButtonStyle.Link, label, url });
const row = (...components: APIMessageActionRowComponent[]): Row => ({ type: ComponentType.ActionRow, components });

export interface Person {
  name: string;
  username: string | null;
  discordId: string | null;
}

export function who(person: Person | null | undefined, live: boolean) {
  if (!person) return "someone";
  if (live && person.discordId) return `<@${person.discordId}>`;
  return person.username ? `@${person.username}` : person.name;
}

export function relative(date: Date, live: boolean, now = new Date()) {
  if (live) return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
  const minutes = Math.round((date.getTime() - now.getTime()) / 60_000);
  const span = Math.abs(minutes) >= 90 ? `${Math.round(Math.abs(minutes) / 60)} h` : `${Math.abs(minutes)} min`;
  return minutes >= 0 ? `in ${span}` : `${span} ago`;
}

const PURPOSE_LABEL = { course: "Course project", club: "Club project", personal: "Personal" } as const;

// --- Request cards ---

export interface CardData {
  booking: {
    id: string;
    title: string | null;
    status: BookingStatus;
    slot: { start: Date; end: Date };
    purpose: keyof typeof PURPOSE_LABEL | null;
    notes: string | null;
    modelUrl: string | null;
    holdExpiresAt: Date | null;
    decisionReason: string | null;
    createdAt: Date;
  };
  owner: Person;
  decidedBy: Person | null;
  upload: { originalName: string; summary: ParsedGcodeSummary } | null;
  printerModel: string;
}

const CARD_BUTTONS: Partial<Record<BookingAction, { label: string; style: ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger; emoji: string }>> = {
  approve: { label: "Approve", style: ButtonStyle.Success, emoji: "✅" },
  reject: { label: "Reject", style: ButtonStyle.Danger, emoji: "✖️" },
  check_in: { label: "Check in", style: ButtonStyle.Primary, emoji: "📍" },
  start: { label: "Start print", style: ButtonStyle.Primary, emoji: "🖨️" },
  finish: { label: "Finished", style: ButtonStyle.Success, emoji: "🏁" },
  fail: { label: "Failed", style: ButtonStyle.Danger, emoji: "⚠️" },
  collect: { label: "Collected", style: ButtonStyle.Primary, emoji: "📦" },
  no_show: { label: "No-show", style: ButtonStyle.Secondary, emoji: "👻" },
  cancel: { label: "Cancel", style: ButtonStyle.Danger, emoji: "🚫" },
};

/** Buttons a staff member gets on a card, straight from the state machine. */
export function cardButtons(status: BookingStatus, bookingId: string, siteOrigin: string): Row[] {
  // On a request, Reject (with a reason) covers Cancel.
  const actions = allowedActions(status, "staff").filter((action) => CARD_BUTTONS[action] && !(status === "pending" && action === "cancel"));
  // Order matters: the main action first, destructive ones last.
  const order: BookingAction[] = ["approve", "check_in", "start", "finish", "collect", "reject", "fail", "no_show", "cancel"];
  const buttons = order
    .filter((action) => actions.includes(action))
    .map((action) => {
      const spec = CARD_BUTTONS[action]!;
      return button(spec.label, action, bookingId, spec.style, spec.emoji);
    });
  if (status === "pending" || status === "approved") buttons.push(button("Move time", "move", bookingId, ButtonStyle.Secondary, "🕒"));
  const link = linkButton("Open in PrintQ", `${siteOrigin}/printing/admin/${status === "pending" ? "approvals" : "session"}`);
  if (buttons.length === 0) return [row(link)];
  // Max five components per row.
  return buttons.length <= 4 ? [row(...buttons, link)] : [row(...buttons.slice(0, 5)), row(...buttons.slice(5), link)];
}

export function renderCard(data: CardData, options: { live: boolean; siteOrigin: string; now?: Date }): MessagePayload {
  const { booking, upload } = data;
  const { live } = options;
  const minutes = (booking.slot.end.getTime() - booking.slot.start.getTime()) / 60_000;
  const summary = upload?.summary;
  const modelOk = summary?.printerModel ? summary.printerModel.toUpperCase().replace(/\s/g, "") === data.printerModel.toUpperCase() : null;
  const specs = [
    summary?.filamentGrams != null ? `${Math.round(summary.filamentGrams)} g ${summary.filamentType ?? ""}`.trim() : null,
    summary?.layerHeightMm ? `${summary.layerHeightMm} mm layers` : null,
    summary?.printerModel ? `${summary.printerModel} ${modelOk ? "✓" : "⚠️ not our printer"}` : null,
  ].filter(Boolean);

  const lines = [
    `${who(data.owner, live)}${booking.purpose ? ` · ${PURPOSE_LABEL[booking.purpose]}` : ""}`,
    `**${formatSlot(booking.slot.start, booking.slot.end)}** (${formatDuration(minutes)})`,
    specs.length ? specs.join(" · ") : null,
    upload ? `\`${upload.originalName}\`` : null,
    booking.modelUrl ? `Model: ${booking.modelUrl}` : null,
    booking.notes ? `> ${booking.notes.replace(/\n/g, "\n> ")}` : null,
  ];
  if (booking.status === "pending" && booking.holdExpiresAt) lines.push(`Hold expires ${relative(booking.holdExpiresAt, live, options.now)}`);
  if (data.decidedBy && booking.status !== "pending") {
    const verb = booking.status === "rejected" ? "Declined" : "Approved";
    if (booking.status === "rejected" || booking.status === "approved") {
      lines.push(`${verb} by ${who(data.decidedBy, live)}${booking.decisionReason ? `: ${booking.decisionReason}` : ""}`);
    }
  }

  return {
    embeds: [
      {
        title: `${STATUS_EMOJI[booking.status]} ${STATUS_LABELS[booking.status]} · ${booking.title ?? "Print"}`.slice(0, 256),
        description: lines.filter(Boolean).join("\n").slice(0, 4000),
        color: STATUS_COLOR[booking.status],
        footer: { text: `Booking ${booking.id.slice(0, 8)}` },
        timestamp: booking.createdAt.toISOString(),
      },
    ],
    components: cardButtons(booking.status, booking.id, options.siteOrigin),
  };
}

// --- Staff board ---

export interface BoardData {
  printerName: string;
  lab: { open: boolean | null; since: string | null };
  printing: { title: string | null; end: Date } | null;
  pendingCount: number;
  days: { label: string; items: { title: string | null; status: BookingStatus; start: Date; end: Date }[] }[];
  closures: { id: string; kind: "closure" | "maintenance"; reason: string; start: Date; end: Date }[];
  hours: { weekday: number; opensAt: string; closesAt: string }[];
  now: Date;
}

const SHORT_DAYS = WEEKDAY_NAMES.map((name) => name.slice(0, 3));
const shortClock = (value: string) => formatClock(value).replace(":00", "").replace(" ", "");

/** "Mon–Thu 10AM–6PM · Fri 10AM–4PM · Sat–Sun closed" */
export function hoursSummary(hours: BoardData["hours"]) {
  const perDay = [1, 2, 3, 4, 5, 6, 0].map((weekday) => ({
    weekday,
    text:
      hours
        .filter((row) => row.weekday === weekday)
        .map((row) => `${shortClock(row.opensAt)}–${shortClock(row.closesAt)}`)
        .join(", ") || "closed",
  }));
  const groups: { from: number; to: number; text: string }[] = [];
  for (const day of perDay) {
    const last = groups.at(-1);
    if (last && last.text === day.text) last.to = day.weekday;
    else groups.push({ from: day.weekday, to: day.weekday, text: day.text });
  }
  return groups.map((group) => `${SHORT_DAYS[group.from]}${group.from !== group.to ? `–${SHORT_DAYS[group.to]}` : ""} ${group.text}`).join(" · ");
}

export function closureLine(closure: BoardData["closures"][number]) {
  const allDay =
    closure.end.getTime() - closure.start.getTime() >= 86_400_000 - 3_600_000 && formatTime(closure.start) === "12:00 AM";
  return `${closure.kind === "maintenance" ? "🔧" : "⛔"} ${formatDay(closure.start)} ${allDay ? "all day" : formatCompactRange(closure.start, closure.end)} · ${closure.reason}`;
}

export function labLine(lab: BoardData["lab"]) {
  if (lab.open === null) return "Lab status unknown";
  return `${lab.open ? "🟢 **Lab open**" : "⚫ **Lab closed**"}${lab.since ? ` · since ${formatDay(lab.since) === formatDay(new Date()) ? formatTime(lab.since) : formatDay(lab.since)}` : ""}`;
}

export function renderBoard(data: BoardData): MessagePayload {
  const fields: NonNullable<APIEmbed["fields"]> = [
    {
      name: "Now printing",
      value: data.printing ? `${data.printing.title ?? "A print"} · ends ${formatTime(data.printing.end)}` : "Nothing",
      inline: true,
    },
    {
      name: "Waiting for review",
      value: data.pendingCount ? `${data.pendingCount} request${data.pendingCount === 1 ? "" : "s"}` : "None 🎉",
      inline: true,
    },
    ...data.days.map((day) => ({
      name: day.label,
      value:
        day.items.map((item) => `\`${formatTime(item.start).padStart(8)}\` ${STATUS_EMOJI[item.status]} ${item.title ?? "Print"}`).join("\n").slice(0, 1000) ||
        "Nothing booked",
    })),
    { name: "Closures", value: data.closures.slice(0, 6).map(closureLine).join("\n") || "None coming up" },
    { name: "Lab hours", value: hoursSummary(data.hours) },
  ];
  const lab = data.lab.open
    ? button("Close lab", "lab", "close", ButtonStyle.Secondary, "🔐")
    : button("Open lab", "lab", "open", ButtonStyle.Success, "🔓");
  const components: Row[] = [
    row(
      lab,
      button("Add closure", "addclosure", "board", ButtonStyle.Primary, "➕"),
      button("Lab hours", "hours", "board", ButtonStyle.Secondary, "🕒"),
      button(`Review (${data.pendingCount})`, "pending", "board", ButtonStyle.Secondary, "📥", data.pendingCount === 0),
      button("Refresh", "refresh", "board", ButtonStyle.Secondary, "↻")
    ),
  ];
  if (data.closures.length) {
    components.push(
      row({
        type: ComponentType.StringSelect,
        custom_id: customId("rmclosure"),
        placeholder: "Remove a closure…",
        options: data.closures.slice(0, 25).map((closure) => ({
          label: closureLine(closure).slice(0, 100),
          value: closure.id,
        })),
      })
    );
  }
  return {
    embeds: [
      {
        title: `PrintQ · ${data.printerName}`,
        description: labLine(data.lab),
        color: data.lab.open ? BRAND : 0x4e5058,
        fields,
        footer: { text: `Updated ${formatTime(data.now)} · Pacific time` },
      },
    ],
    components,
  };
}

// --- Anonymous schedule (/print schedule and the public board) ---

export function scheduleEmbed(input: { printerName: string; calendar: CalendarData; lab: BoardData["lab"]; days?: number }): APIEmbed {
  const { calendar } = input;
  const busy = calendar.blocks.filter((block) => block.kind !== "closure");
  const days = [...new Set(calendar.windows.map((window) => formatDay(window.start)))].slice(0, input.days ?? 2);
  const fields = days.map((day) => {
    const windows = calendar.windows.filter((window) => formatDay(window.start) === day);
    const lines: string[] = [];
    for (const window of windows) {
      let cursor = new Date(window.start).getTime();
      const end = new Date(window.end).getTime();
      const inWindow = busy
        .filter((block) => new Date(block.end).getTime() > cursor && new Date(block.start).getTime() < end)
        .sort((a, b) => a.start.localeCompare(b.start));
      for (const block of inWindow) {
        const blockStart = new Date(block.start).getTime();
        if (blockStart > cursor) lines.push(`🟢 Free ${formatCompactRange(new Date(cursor), new Date(blockStart))}`);
        lines.push(
          `${block.kind === "pending" ? "⏳ Pending" : block.kind === "printing" ? "🖨️ Printing" : block.kind === "maintenance" ? "🔧 Maintenance" : "⬛ Booked"} ${formatCompactRange(block.start, block.end)}`
        );
        cursor = Math.max(cursor, new Date(block.end).getTime());
      }
      if (cursor < end) lines.push(`🟢 Free ${formatCompactRange(new Date(cursor), new Date(end))}`);
    }
    return { name: day, value: lines.join("\n").slice(0, 1000) || "No lab hours", inline: true };
  });
  return {
    title: `${input.printerName} · schedule`,
    description: `${input.lab.open === true ? "🟢 Lab open" : input.lab.open === false ? "⚫ Lab closed" : "Lab status unknown"} · Pacific time · names are never shown`,
    color: BRAND,
    fields: fields.length ? fields : [{ name: "No lab hours", value: "Nothing scheduled in the next week." }],
  };
}

export function renderPublicBoard(input: Parameters<typeof scheduleEmbed>[0] & { siteOrigin: string; now: Date }): MessagePayload {
  const embed = scheduleEmbed({ ...input, days: 3 });
  return {
    embeds: [{ ...embed, title: `🖨️ ${input.printerName} · this week`, footer: { text: `Updated ${formatTime(input.now)}` } }],
    components: [row(linkButton("Book a print", `${input.siteOrigin}/printing/new`), linkButton("My prints", `${input.siteOrigin}/printing/me`))],
  };
}

// --- Ephemeral helpers ---

export function pendingList(items: { id: string; title: string | null; start: Date; end: Date; owner: Person }[], live: boolean): MessagePayload {
  if (items.length === 0) return { content: "Nothing waiting for review. 🎉", embeds: [], components: [] };
  return {
    embeds: [
      {
        title: `📥 ${items.length} request${items.length === 1 ? "" : "s"} waiting`,
        color: STATUS_COLOR.pending,
        description: items
          .slice(0, 20)
          .map((item) => `**${item.title ?? "Print"}** · ${formatSlot(item.start, item.end)} · ${who(item.owner, live)}`)
          .join("\n"),
      },
    ],
    components: [
      row({
        type: ComponentType.StringSelect,
        custom_id: customId("show", "pending"),
        placeholder: "Open a request…",
        options: items.slice(0, 25).map((item) => ({
          label: `${item.title ?? "Print"}`.slice(0, 100),
          description: `${formatSlot(item.start, item.end)} · ${item.owner.username ?? item.owner.name}`.slice(0, 100),
          value: item.id,
        })),
      }),
    ],
  };
}

export function hoursMessage(hours: BoardData["hours"]): MessagePayload {
  const lines = [1, 2, 3, 4, 5, 6, 0].map((weekday) => {
    const text = hours
      .filter((row) => row.weekday === weekday)
      .map((row) => `${formatClock(row.opensAt)} – ${formatClock(row.closesAt)}`)
      .join(", ");
    return `**${WEEKDAY_NAMES[weekday]}** ${text || "closed"}`;
  });
  const dayButton = (weekday: number) => button(SHORT_DAYS[weekday], "hoursday", String(weekday), ButtonStyle.Secondary);
  return {
    embeds: [{ title: "🕒 Lab hours", description: `${lines.join("\n")}\n\nPrints may **start** inside these hours. Pick a day to change it.`, color: BRAND }],
    components: [row(...[1, 2, 3, 4, 5].map(dayButton)), row(dayButton(6), dayButton(0))],
  };
}

export function closureConfirmation(input: {
  draftId: string;
  start: Date;
  end: Date;
  allDay: boolean;
  kind: "closure" | "maintenance";
  reason: string;
  affected: { title: string | null; status: BookingStatus; owner: Person }[];
  live: boolean;
}): MessagePayload {
  const when = input.allDay ? `${formatDay(input.start)}, all day` : formatSlot(input.start, input.end);
  const label = input.kind === "maintenance" ? "Maintenance" : "Closure";
  const lines = [`**${label}:** ${when}`, `**Reason:** ${input.reason}`];
  if (input.affected.length) {
    lines.push(
      "",
      `This affects **${input.affected.length}** booking${input.affected.length === 1 ? "" : "s"}:`,
      ...input.affected.map((item) => `${STATUS_EMOJI[item.status]} ${item.title ?? "Print"} (${who(item.owner, input.live)})`),
      "",
      "*Close and notify* marks approved prints \"Lab closed\", declines pending requests and DMs each member."
    );
  } else lines.push("", "No bookings are affected.");
  const buttons = input.affected.length
    ? [
        button(`Close and notify ${input.affected.length}`, "closeok", input.draftId, ButtonStyle.Danger),
        button("Add, keep bookings", "closekeep", input.draftId, ButtonStyle.Secondary),
        button("Cancel", "closecancel", input.draftId, ButtonStyle.Secondary),
      ]
    : [button(`Add ${label.toLowerCase()}`, "closekeep", input.draftId, ButtonStyle.Primary), button("Cancel", "closecancel", input.draftId, ButtonStyle.Secondary)];
  return {
    embeds: [{ title: `Add this ${label.toLowerCase()}?`, description: lines.join("\n"), color: input.kind === "maintenance" ? 0xf5a524 : 0xf87171 }],
    components: [row(...buttons)],
  };
}

// --- Modals ---

const textInput = (custom_id: string, label: string, options: { placeholder?: string; required?: boolean; max?: number; paragraph?: boolean; value?: string } = {}) => ({
  type: ComponentType.ActionRow as const,
  components: [
    {
      type: ComponentType.TextInput as const,
      custom_id,
      label,
      style: options.paragraph ? TextInputStyle.Paragraph : TextInputStyle.Short,
      required: options.required ?? true,
      ...(options.placeholder ? { placeholder: options.placeholder } : {}),
      ...(options.value ? { value: options.value } : {}),
      max_length: options.max ?? 200,
    },
  ],
});

export function reasonModal(action: "reject" | "fail" | "cancel", bookingId: string): APIModalInteractionResponseCallbackData {
  const titles = { reject: "Reject print request", fail: "Mark print failed", cancel: "Cancel booking" };
  return {
    custom_id: customId(`m_${action}`, bookingId),
    title: titles[action],
    components: [textInput("reason", "Reason (shown to the member)", { placeholder: action === "fail" ? "Spaghetti at layer 40" : "Wrong printer profile", required: action !== "cancel" })],
  };
}

export function moveModal(bookingId: string, currentStart: Date): APIModalInteractionResponseCallbackData {
  return {
    custom_id: customId("m_move", bookingId),
    title: "Move booking",
    components: [
      textInput("when", "New start (keeps the same length)", {
        placeholder: `Now ${formatDay(currentStart)} ${formatTime(currentStart)}. e.g. Wed 2pm`,
        max: 60,
      }),
    ],
  };
}

export function closureModal(): APIModalInteractionResponseCallbackData {
  return {
    custom_id: customId("m_closure", "new"),
    title: "Add a closure",
    components: [
      textInput("when", "When", { placeholder: "Fri 12:30-4pm · Oct 9 all day · today 2pm-3pm", max: 60 }),
      textInput("reason", "Reason", { placeholder: "CSA general meeting", max: 120 }),
      textInput("kind", "Type: closure or maintenance", { placeholder: "closure", required: false, max: 20 }),
    ],
  };
}

export function hoursModal(weekday: number, current: string): APIModalInteractionResponseCallbackData {
  return {
    custom_id: customId("m_hours", String(weekday)),
    title: `Lab hours · ${WEEKDAY_NAMES[weekday]}`,
    components: [textInput("hours", "Hours (or \"closed\")", { placeholder: "10:00-18:00 · 10am-12, 1pm-5pm · closed", value: current, max: 60 })],
  };
}

export const CLOSURE_HELP = `Try ${WHEN_EXAMPLES}.`;

// --- Member DMs ---

export function memberButtons(kind: "cancel" | "moved", bookingId: string): Row[] {
  if (kind === "moved") {
    return [row(button("Keep it", "mkeep", bookingId, ButtonStyle.Success), button("Cancel booking", "mcancel", bookingId, ButtonStyle.Danger))];
  }
  return [row(button("Cancel booking", "mcancel", bookingId, ButtonStyle.Secondary))];
}
