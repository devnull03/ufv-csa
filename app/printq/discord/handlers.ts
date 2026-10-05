import "server-only";
import {
  ButtonStyle,
  ComponentType,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  type APIApplicationCommandInteractionDataOption,
  type APIEmbed,
  type APIInteraction,
  type APIMessageComponentInteraction,
  type APIModalSubmitInteraction,
} from "discord-api-types/v10";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import {
  affectedByClosure,
  createClosure,
  listLabHours,
  listUpcomingClosures,
  parseClosureRange,
  removeClosure,
  saveClosureDraft,
  setLabHours,
  takeClosureDraft,
  type ClosureKind,
} from "../availability";
import { inBackground } from "../background";
import { moveBooking, transitionBooking } from "../bookings";
import { PRINTQ_TIMEZONE, SLOT_HOLDING_STATUSES } from "../constants";
import { db, schema } from "../db/client";
import { isPrintQEnabled, printqEnv, siteOrigin } from "../env";
import { PrintQError } from "../errors";
import { formatClock, formatDay, formatSlot, formatTime, STATUS_LABELS, WEEKDAY_NAMES } from "../format";
import { getLabStatus } from "../lab-status";
import { onBookingMoved, onBookingTransition } from "../notify";
import { viewerForDiscordId } from "../profiles";
import { getActivePrinter, loadCalendar } from "../schedule";
import type { BookingAction } from "../scheduling/state-machine";
import { parseStart, WhenParseError } from "../scheduling/when";
import { PRINT_COMMAND_NAME, PRINT_STAFF_COMMAND_NAME, PRINTQ_CUSTOM_ID_PREFIX, parsePrintqCustomId } from "./commands";
import {
  closureConfirmation,
  closureLine,
  closureModal,
  hoursMessage,
  hoursModal,
  moveModal,
  pendingList,
  reasonModal,
  scheduleEmbed,
  type MessagePayload,
} from "./render";
import { discordFetch } from "./rest";
import { setRoomStatus } from "./room";
import { requireDiscordStaff, interactionUser } from "./staff";
import { isLive, renderBoardNow, renderCardFor, repostBoard, syncBoards, syncBooking } from "./sync";

export function isPrintQInteraction(interaction: APIInteraction): boolean {
  if (!isPrintQEnabled()) return false;
  switch (interaction.type) {
    case InteractionType.ApplicationCommand:
    case InteractionType.ApplicationCommandAutocomplete:
      return interaction.data.name === PRINT_COMMAND_NAME || interaction.data.name === PRINT_STAFF_COMMAND_NAME;
    case InteractionType.MessageComponent:
    case InteractionType.ModalSubmit:
      return interaction.data.custom_id.startsWith(PRINTQ_CUSTOM_ID_PREFIX);
    default:
      return false;
  }
}

type Response = { type: InteractionResponseType; data?: unknown };

const reply = (data: { content?: string; embeds?: APIEmbed[]; ephemeral?: boolean; components?: unknown[] }): Response => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: {
    content: data.content,
    embeds: data.embeds,
    components: data.components,
    flags: data.ephemeral === false ? undefined : MessageFlags.Ephemeral,
    allowed_mentions: { parse: [] },
  },
});
const ephemeral = (payload: MessagePayload): Response => reply({ ...payload, ephemeral: true });
const update = (payload: MessagePayload): Response => ({
  type: InteractionResponseType.UpdateMessage,
  data: { content: payload.content ?? "", embeds: payload.embeds, components: payload.components, allowed_mentions: { parse: [] } },
});

const siteButton = (label: string, path: string) => ({
  type: ComponentType.ActionRow,
  components: [{ type: ComponentType.Button, style: ButtonStyle.Link, label, url: `${siteOrigin()}${path}` }],
});

const discordUserId = (interaction: APIInteraction) => interactionUser(interaction)?.id ?? "";

/** Hooks touch Discord's REST API when live, so they run after the response; in demo mode they're local and run inline. */
async function runHook(task: () => Promise<unknown>) {
  if (isLive()) inBackground(task);
  else await task();
}

/**
 * For work that may take longer than Discord's 3 seconds when live: acknowledge
 * now, finish in the background and edit the message afterwards. In demo mode
 * it just runs and updates the message.
 */
async function deferredUpdate(interaction: APIInteraction, work: () => Promise<MessagePayload>): Promise<Response> {
  if (!isLive()) return update(await work());
  inBackground(async () => {
    try {
      const payload = await work();
      await discordFetch(`/webhooks/${printqEnv().DISCORD_BOT_ID}/${interaction.token}/messages/@original`, {
        method: "PATCH",
        body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
      });
    } catch (error) {
      const message = error instanceof PrintQError ? error.message : "Something went wrong. Try again on the website.";
      if (!(error instanceof PrintQError)) console.error("PrintQ deferred interaction failed", error);
      await discordFetch(`/webhooks/${printqEnv().DISCORD_BOT_ID}/${interaction.token}`, {
        method: "POST",
        body: JSON.stringify({ content: `:warning: ${message}`, flags: MessageFlags.Ephemeral }),
      }).catch(() => undefined);
    }
  });
  return { type: InteractionResponseType.DeferredMessageUpdate };
}

/**
 * Entry point called from app/(site)/api/webhooks/discord/interact/route.ts after
 * signature verification (and by the demo-mode Discord preview).
 */
export async function handlePrintQInteraction(interaction: APIInteraction): Promise<NextResponse> {
  return NextResponse.json(await respond(interaction));
}

export async function respond(interaction: APIInteraction): Promise<Response> {
  try {
    return await route(interaction);
  } catch (error) {
    const message =
      error instanceof PrintQError ? error.message : error instanceof WhenParseError ? error.message : "Something went wrong. Try again on the website.";
    if (!(error instanceof PrintQError) && !(error instanceof WhenParseError)) console.error("PrintQ interaction failed", error);
    return reply({ content: `:warning: ${message}` });
  }
}

type Options = APIApplicationCommandInteractionDataOption[];
const optionReader = (options: Options) => (name: string) => options.find((item) => item.name === name) as { value?: unknown; focused?: boolean } | undefined;

async function route(interaction: APIInteraction): Promise<Response> {
  switch (interaction.type) {
    case InteractionType.ApplicationCommand: {
      if (interaction.data.type !== 1) break;
      const [sub] = (interaction.data.options ?? []) as Options;
      const options = sub && "options" in sub ? ((sub.options ?? []) as Options) : [];
      const option = optionReader(options);
      if (interaction.data.name === PRINT_COMMAND_NAME) {
        if (sub?.name === "schedule") return scheduleReply(option("show_in_channel")?.value === true);
        if (sub?.name === "mine") return mineReply(discordUserId(interaction));
        if (sub?.name === "cancel") return cancelReply(discordUserId(interaction), String(option("booking")?.value ?? ""));
      } else return staffCommand(interaction, sub?.name ?? "", option);
      break;
    }
    case InteractionType.ApplicationCommandAutocomplete: {
      const [sub] = (interaction.data.options ?? []) as Options;
      const options = sub && "options" in sub ? ((sub.options ?? []) as Options) : [];
      const focused = options.find((item) => "focused" in item && item.focused) as { name: string; value?: unknown } | undefined;
      const text = String(focused?.value ?? "");
      let choices: { name: string; value: string }[] = [];
      if (interaction.data.name === PRINT_COMMAND_NAME) choices = await cancellableChoices(discordUserId(interaction));
      else if (focused?.name === "search") choices = await bookingChoices(text);
      else if (focused?.name === "when") choices = whenChoices(text);
      else if (focused?.name === "closure") choices = await closureChoices();
      return { type: InteractionResponseType.ApplicationCommandAutocompleteResult, data: { choices } };
    }
    case InteractionType.MessageComponent:
      return component(interaction);
    case InteractionType.ModalSubmit:
      return modal(interaction);
  }
  return reply({ content: "Unknown PrintQ action." });
}

// --- Member commands ---

async function scheduleReply(showInChannel: boolean) {
  const printer = await getActivePrinter();
  const now = new Date();
  const [calendar, lab] = await Promise.all([loadCalendar(printer.id, { start: now, end: new Date(now.getTime() + 7 * 86_400_000) }), getLabStatus()]);
  return reply({
    embeds: [scheduleEmbed({ printerName: printer.name, calendar, lab })],
    ephemeral: !showInChannel,
    components: [siteButton("Book on the website", "/printing/new")],
  });
}

async function mineReply(discordId: string) {
  const viewer = await viewerForDiscordId(discordId);
  if (!viewer) return reply({ content: "Sign in to PrintQ once with Discord to see your prints here.", components: [siteButton("Open PrintQ", "/printing/login")] });
  const rows = await db()
    .select({ id: schema.bookings.id, title: schema.bookings.title, status: schema.bookings.status, slot: schema.bookings.slot })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.ownerId, viewer.userId), inArray(schema.bookings.status, [...SLOT_HOLDING_STATUSES, "finished"])))
    .orderBy(asc(sql`lower(${schema.bookings.slot})`))
    .limit(10);
  if (rows.length === 0) return reply({ content: "You have no upcoming prints.", components: [siteButton("Book a print", "/printing/new")] });
  return reply({
    embeds: [
      {
        title: "Your upcoming prints",
        color: 0x52a040,
        description: rows.map((row) => `**${row.title ?? "Print"}** · ${formatSlot(row.slot.start, row.slot.end)} · ${STATUS_LABELS[row.status]}`).join("\n"),
      },
    ],
    components: [siteButton("My prints", "/printing/me")],
  });
}

async function cancellableChoices(discordId: string) {
  const viewer = await viewerForDiscordId(discordId);
  if (!viewer) return [];
  const rows = await db()
    .select({ id: schema.bookings.id, title: schema.bookings.title, slot: schema.bookings.slot })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.ownerId, viewer.userId), inArray(schema.bookings.status, ["pending", "approved"])))
    .orderBy(asc(sql`lower(${schema.bookings.slot})`))
    .limit(25);
  return rows.map((row) => ({ name: `${row.title ?? "Print"} · ${formatDay(row.slot.start)} ${formatTime(row.slot.start)}`.slice(0, 100), value: row.id }));
}

async function cancelAsOwner(discordId: string, bookingId: string) {
  const viewer = await viewerForDiscordId(discordId);
  if (!viewer) throw new PrintQError("forbidden", "Sign in to PrintQ once with Discord first.");
  if (!/^[0-9a-f-]{36}$/.test(bookingId)) throw new PrintQError("bad_request", "Pick a booking from the list.");
  const [owned] = await db()
    .select({ id: schema.bookings.id })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.id, bookingId), eq(schema.bookings.ownerId, viewer.userId)))
    .limit(1);
  if (!owned) throw new PrintQError("not_found", "That isn't one of your bookings.");
  const booking = await transitionBooking({ ...viewer, role: "member" }, bookingId, "cancel");
  await runHook(() => onBookingTransition(booking, "cancel", viewer.userId));
  return booking;
}

async function cancelReply(discordId: string, bookingId: string) {
  const booking = await cancelAsOwner(discordId, bookingId);
  return reply({ content: `Cancelled **${booking.title ?? "your print"}** (${formatSlot(booking.slot.start, booking.slot.end)}).` });
}

// --- Staff commands ---

async function staffCommand(interaction: APIInteraction, sub: string, option: ReturnType<typeof optionReader>): Promise<Response> {
  const viewer = await requireDiscordStaff(interaction, sub === "hours" && option("hours") ? "admin" : "staff");
  switch (sub) {
    case "pending":
      return ephemeral(await pendingMessage());
    case "booking": {
      const id = await findBooking(String(option("search")?.value ?? ""));
      if (!id) return reply({ content: "No booking matches that." });
      return showCard(id);
    }
    case "close": {
      const kind: ClosureKind = option("maintenance")?.value === true ? "maintenance" : "closure";
      return ephemeral(await draftClosure(String(option("when")?.value ?? ""), String(option("reason")?.value ?? ""), kind, viewer.userId));
    }
    case "reopen": {
      const removed = await removeClosure(String(option("closure")?.value ?? ""));
      return reply({ content: `Removed: ${closureLine({ ...removed.during, id: removed.id, kind: removed.kind, reason: removed.reason })}` });
    }
    case "hours": {
      const day = option("day")?.value;
      const hours = option("hours")?.value;
      if (typeof day === "number" && typeof hours === "string") {
        const ranges = await setLabHours(day, hours);
        return ephemeral({
          content: `**${WEEKDAY_NAMES[day]}** is now ${ranges.length ? ranges.map((range) => `${formatClock(range.opensAt)}–${formatClock(range.closesAt)}`).join(", ") : "closed"}.`,
          ...hoursMessage(await listLabHours()),
        });
      }
      return ephemeral(hoursMessage(await listLabHours()));
    }
    case "board":
      await repostBoard();
      return reply({ content: "Board posted and pinned." });
  }
  return reply({ content: "Unknown command." });
}

async function pendingMessage() {
  const rows = await db()
    .select({
      id: schema.bookings.id,
      title: schema.bookings.title,
      slot: schema.bookings.slot,
      name: schema.user.name,
      username: schema.profiles.discordUsername,
      discordId: schema.profiles.discordId,
    })
    .from(schema.bookings)
    .innerJoin(schema.user, eq(schema.user.id, schema.bookings.ownerId))
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.bookings.ownerId))
    .where(eq(schema.bookings.status, "pending"))
    .orderBy(asc(sql`lower(${schema.bookings.slot})`))
    .limit(25);
  return pendingList(
    rows.map((row) => ({ id: row.id, title: row.title, ...row.slot, owner: { name: row.name, username: row.username, discordId: row.discordId } })),
    isLive()
  );
}

async function showCard(bookingId: string) {
  const card = await renderCardFor(bookingId);
  if (!card) throw new PrintQError("not_found", "Booking not found");
  return ephemeral(card);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function searchBookings(text: string) {
  const term = `%${text.trim().replace(/^@/, "")}%`;
  return db()
    .select({ id: schema.bookings.id, title: schema.bookings.title, status: schema.bookings.status, slot: schema.bookings.slot, username: schema.profiles.discordUsername })
    .from(schema.bookings)
    .innerJoin(schema.user, eq(schema.user.id, schema.bookings.ownerId))
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.bookings.ownerId))
    .where(text.trim() ? or(ilike(schema.bookings.title, term), ilike(schema.user.name, term), ilike(schema.profiles.discordUsername, term)) : undefined)
    .orderBy(desc(sql`lower(${schema.bookings.slot})`))
    .limit(25);
}

async function findBooking(text: string) {
  if (UUID.test(text)) return text;
  const [first] = await searchBookings(text);
  return first?.id ?? null;
}

async function bookingChoices(text: string) {
  const rows = await searchBookings(text);
  return rows.map((row) => ({
    name: `${row.title ?? "Print"} · ${row.username ? `@${row.username} · ` : ""}${formatDay(row.slot.start)} · ${STATUS_LABELS[row.status]}`.slice(0, 100),
    value: row.id,
  }));
}

function whenChoices(text: string) {
  if (!text.trim()) return ["today 2pm-3pm", "tomorrow all day", "Fri 12:30-4pm"].map((example) => ({ name: example, value: example }));
  try {
    const range = parseClosureRange(text);
    const label = range.allDay ? `${formatDay(range.start)}, all day` : formatSlot(range.start, range.end);
    return [{ name: `✓ ${label}`.slice(0, 100), value: text.slice(0, 100) }];
  } catch {
    return [{ name: `? Not sure what "${text}" means. Try Fri 12:30-4pm`.slice(0, 100), value: text.slice(0, 100) }];
  }
}

async function closureChoices() {
  const rows = await listUpcomingClosures();
  return rows.map((row) => ({ name: closureLine({ id: row.id, kind: row.kind, reason: row.reason, ...row.during }).slice(0, 100), value: row.id }));
}

async function draftClosure(when: string, reason: string, kind: ClosureKind, userId: string): Promise<MessagePayload> {
  const range = parseClosureRange(when);
  if (!reason.trim()) throw new PrintQError("bad_request", "Give the closure a reason.");
  const affected = await affectedByClosure(range, kind);
  const draftId = await saveClosureDraft({ start: range.start.toISOString(), end: range.end.toISOString(), kind, reason: reason.trim(), by: userId });
  return closureConfirmation({
    draftId,
    ...range,
    kind,
    reason: reason.trim(),
    affected: affected.map((item) => ({ title: item.title, status: item.status, owner: { name: item.ownerName, username: item.ownerUsername, discordId: null } })),
    live: isLive(),
  });
}

// --- Buttons and select menus ---

const SIMPLE_ACTIONS = new Set<BookingAction>(["approve", "check_in", "start", "finish", "collect", "no_show"]);

async function component(interaction: APIMessageComponentInteraction): Promise<Response> {
  const { action, bookingId: id } = parsePrintqCustomId(interaction.data.custom_id);
  const values = "values" in interaction.data ? interaction.data.values : [];

  // Members, from DMs.
  if (action === "mcancel") {
    const booking = await cancelAsOwner(discordUserId(interaction), id);
    return update({
      content: `🚫 Cancelled **${booking.title ?? "your print"}**. The slot is free for someone else.`,
      embeds: interaction.message.embeds,
      components: [],
    });
  }
  if (action === "mkeep") {
    const viewer = await viewerForDiscordId(discordUserId(interaction));
    const [owned] = viewer
      ? await db().select({ id: schema.bookings.id }).from(schema.bookings).where(and(eq(schema.bookings.id, id), eq(schema.bookings.ownerId, viewer.userId))).limit(1)
      : [];
    if (!owned) throw new PrintQError("not_found", "That isn't one of your bookings.");
    await runHook(() => syncBooking(id, "👍 Member is keeping the new time"));
    return update({ content: "👍 Great, see you then.", embeds: interaction.message.embeds, components: [] });
  }

  // Lab toggle: PrintQ staff, or anyone allowed to use /sccroom.
  if (action === "lab") {
    const sccRole = process.env.DISCORD_SCC_ROOM_ROLE_ID;
    let actorUserId: string | null = null;
    if (!(sccRole && interaction.member?.roles.includes(sccRole))) actorUserId = (await requireDiscordStaff(interaction)).userId;
    const open = id === "open";
    return deferredUpdate(interaction, async () => {
      await setRoomStatus({ open, discordUserId: discordUserId(interaction), actorUserId });
      return (await renderBoardNow()) ?? { content: `Lab ${open ? "opened" : "closed"}.`, embeds: [], components: [] };
    });
  }

  if (action === "hoursday") {
    await requireDiscordStaff(interaction, "admin");
    const weekday = Number(id);
    const hours = (await listLabHours()).filter((row) => row.weekday === weekday);
    const current = hours.map((row) => `${row.opensAt.slice(0, 5)}-${row.closesAt.slice(0, 5)}`).join(", ") || "closed";
    return { type: InteractionResponseType.Modal, data: hoursModal(weekday, current) };
  }

  const viewer = await requireDiscordStaff(interaction);
  if (SIMPLE_ACTIONS.has(action as BookingAction)) return bookingAction(viewer, id, action as BookingAction);
  switch (action) {
    case "reject":
    case "fail":
    case "cancel":
      return { type: InteractionResponseType.Modal, data: reasonModal(action, id) };
    case "move": {
      const [booking] = await db().select({ slot: schema.bookings.slot }).from(schema.bookings).where(eq(schema.bookings.id, id)).limit(1);
      if (!booking) throw new PrintQError("not_found", "Booking not found");
      return { type: InteractionResponseType.Modal, data: moveModal(id, booking.slot.start) };
    }
    case "addclosure":
      return { type: InteractionResponseType.Modal, data: closureModal() };
    case "hours":
      return ephemeral(hoursMessage(await listLabHours()));
    case "pending":
      return ephemeral(await pendingMessage());
    case "show":
      return showCard(values[0] ?? "");
    case "refresh":
      await runHook(syncBoards);
      return update((await renderBoardNow()) ?? { content: "No printer set up yet.", embeds: [], components: [] });
    case "rmclosure":
      return deferredUpdate(interaction, async () => {
        await removeClosure(values[0] ?? "");
        return (await renderBoardNow()) ?? { embeds: [], components: [] };
      });
    case "closeok":
    case "closekeep":
    case "closecancel": {
      const draft = await takeClosureDraft(id);
      if (!draft) return update({ content: "This confirmation was already used or has expired.", embeds: [], components: [] });
      if (action === "closecancel") return update({ content: "Cancelled. Nothing changed.", embeds: [], components: [] });
      return deferredUpdate(interaction, async () => {
        const result = await createClosure({
          range: { start: new Date(draft.start), end: new Date(draft.end) },
          kind: draft.kind,
          reason: draft.reason,
          actor: viewer,
          closeAffected: action === "closeok",
        });
        const line = closureLine({ id: result.closure.id, kind: result.closure.kind, reason: result.closure.reason, ...result.closure.during });
        const tail =
          action === "closeok" && result.changed
            ? `\n${result.changed} booking${result.changed === 1 ? "" : "s"} closed; members were messaged.`
            : result.affected.length
              ? `\n${result.affected.length} booking${result.affected.length === 1 ? "" : "s"} kept as they were.`
              : "";
        return { content: `✅ Added ${line}${tail}`, embeds: [], components: [] };
      });
    }
  }
  return reply({ content: "Unknown PrintQ action." });
}

async function bookingAction(viewer: Awaited<ReturnType<typeof requireDiscordStaff>>, bookingId: string, action: BookingAction, note?: string): Promise<Response> {
  let booking;
  try {
    booking = await transitionBooking(viewer, bookingId, action, note);
  } catch (error) {
    if (!(error instanceof PrintQError) || error.code !== "invalid_transition") throw error;
    // Someone got there first (or a double click): say what happened and freshen the card.
    const [current] = await db()
      .select({ status: schema.bookings.status, decidedBy: schema.user.name })
      .from(schema.bookings)
      .leftJoin(schema.user, eq(schema.user.id, schema.bookings.decidedBy))
      .where(eq(schema.bookings.id, bookingId))
      .limit(1);
    await runHook(() => syncBooking(bookingId));
    const by = current?.decidedBy && (current.status === "approved" || current.status === "rejected") ? ` by ${current.decidedBy}` : "";
    return reply({ content: `This booking is already **${current ? STATUS_LABELS[current.status].toLowerCase() : "gone"}**${by}.` });
  }
  await runHook(() => onBookingTransition(booking, action, viewer.userId, note));
  const card = await renderCardFor(bookingId);
  return card ? update(card) : reply({ content: "Done." });
}

// --- Modals ---

function field(interaction: APIModalSubmitInteraction, name: string) {
  // Action rows of text inputs (and, in newer modals, labelled single components).
  for (const row of interaction.data.components as unknown as { components?: unknown[]; component?: unknown }[]) {
    const inputs = row.components ?? (row.component ? [row.component] : []);
    for (const input of inputs as { custom_id?: string; value?: string }[]) {
      if (input.custom_id === name) return input.value ?? "";
    }
  }
  return "";
}

async function modal(interaction: APIModalSubmitInteraction): Promise<Response> {
  const { action, bookingId: id } = parsePrintqCustomId(interaction.data.custom_id);
  if (action === "m_hours") {
    await requireDiscordStaff(interaction, "admin");
    const weekday = Number(id);
    const hours = field(interaction, "hours");
    return deferredUpdate(interaction, async () => {
      const ranges = await setLabHours(weekday, hours);
      return {
        ...hoursMessage(await listLabHours()),
        content: `**${WEEKDAY_NAMES[weekday]}** is now ${ranges.length ? ranges.map((range) => `${formatClock(range.opensAt)}–${formatClock(range.closesAt)}`).join(", ") : "closed"}.`,
      };
    });
  }
  const viewer = await requireDiscordStaff(interaction);
  switch (action) {
    case "m_reject":
    case "rejectmodal":
      return bookingAction(viewer, id, "reject", field(interaction, "reason") || undefined);
    case "m_fail":
      return bookingAction(viewer, id, "fail", field(interaction, "reason") || undefined);
    case "m_cancel":
      return bookingAction(viewer, id, "cancel", field(interaction, "reason") || undefined);
    case "m_move": {
      const start = parseStart(field(interaction, "when"), new Date(), PRINTQ_TIMEZONE);
      const { booking, from } = await moveBooking(viewer, id, start);
      await runHook(() => onBookingMoved(booking, from, viewer.userId));
      const card = await renderCardFor(id);
      return card ? update(card) : reply({ content: `Moved to ${formatSlot(booking.slot.start, booking.slot.end)}.` });
    }
    case "m_closure": {
      const kindText = field(interaction, "kind").trim().toLowerCase();
      const kind: ClosureKind = kindText.startsWith("main") ? "maintenance" : "closure";
      if (kindText && !kindText.startsWith("main") && !kindText.startsWith("clos")) {
        throw new PrintQError("bad_request", 'Type must be "closure" or "maintenance".');
      }
      return ephemeral(await draftClosure(field(interaction, "when"), field(interaction, "reason"), kind, viewer.userId));
    }
  }
  return reply({ content: "Unknown PrintQ form." });
}
