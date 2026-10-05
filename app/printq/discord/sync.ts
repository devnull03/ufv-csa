import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { PRINTQ_TIMEZONE } from "../constants";
import { db, schema } from "../db/client";
import { discordBotConfigured, printqEnv, siteOrigin } from "../env";
import { formatDay } from "../format";
import { getLabStatus } from "../lab-status";
import { loadCalendar } from "../schedule";
import { addLocalDays, fromLocal, localDateOf } from "../scheduling/time";
import { DiscordApiError, discordFetch } from "./rest";
import { renderBoard, renderCard, renderPublicBoard, type BoardData, type CardData, type MessagePayload, type Person } from "./render";

// Keeps the bot's long-lived messages in step with the database: one card per
// booking in the staff channel, the pinned staff board, and the optional public
// board. Live: posts once, then edits in place (re-posting if someone deleted
// it). Demo: stores the rendered payload so the staff preview can show it.

type Kind = "card" | "board" | "public_board";
type MessageRow = typeof schema.discordMessages.$inferSelect;

export const isLive = () => discordBotConfigured();

async function deliver(
  kind: Kind,
  bookingId: string | null,
  payload: MessagePayload,
  options: { channelId?: string; thread?: string; pin?: boolean }
): Promise<MessageRow | null> {
  const live = isLive();
  if (live && !options.channelId) return null;
  const table = schema.discordMessages;
  return db().transaction(async (tx) => {
    // One writer per message, so two quick changes can't both post a new card.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`printq:discord:${kind}:${bookingId ?? ""}`}))`);
    const [existing] = await tx
      .select()
      .from(table)
      .where(and(eq(table.kind, kind), bookingId ? eq(table.bookingId, bookingId) : isNull(table.bookingId)))
      .limit(1);

    const create = async () => {
      let channelId = "demo";
      let messageId = `demo-${randomUUID()}`;
      let threadId: string | null = null;
      if (live) {
        channelId = options.channelId!;
        const message = await discordFetch<{ id: string }>(`/channels/${channelId}/messages`, {
          method: "POST",
          body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
        });
        messageId = message.id;
        if (options.thread) {
          try {
            const thread = await discordFetch<{ id: string }>(`/channels/${channelId}/messages/${messageId}/threads`, {
              method: "POST",
              body: JSON.stringify({ name: options.thread.slice(0, 100), auto_archive_duration: 10080 }),
            });
            threadId = thread.id;
          } catch (error) {
            console.error("PrintQ: couldn't start a thread on the card", error);
          }
        }
        if (options.pin) {
          await discordFetch(`/channels/${channelId}/pins/${messageId}`, { method: "PUT" }).catch((error) =>
            console.error("PrintQ: couldn't pin the board", error)
          );
        }
      }
      const [row] = await tx.insert(table).values({ kind, bookingId, channelId, messageId, threadId, payload }).returning();
      return row;
    };

    if (!existing) return create();
    if (live && existing.channelId !== "demo") {
      try {
        await discordFetch(`/channels/${existing.channelId}/messages/${existing.messageId}`, {
          method: "PATCH",
          body: JSON.stringify({ ...payload, allowed_mentions: { parse: [] } }),
        });
      } catch (error) {
        // Deleted by someone: post a fresh one.
        if (!(error instanceof DiscordApiError && error.status === 404)) throw error;
        await tx.delete(table).where(eq(table.id, existing.id));
        return create();
      }
    } else if (live) {
      // A demo-era row while live: replace it with a real message.
      await tx.delete(table).where(eq(table.id, existing.id));
      return create();
    }
    const [row] = await tx.update(table).set({ payload, updatedAt: new Date() }).where(eq(table.id, existing.id)).returning();
    return row;
  });
}

// --- Cards ---

async function person(userId: string | null): Promise<Person | null> {
  if (!userId) return null;
  const [row] = await db()
    .select({ name: schema.user.name, username: schema.profiles.discordUsername, discordId: schema.profiles.discordId })
    .from(schema.user)
    .leftJoin(schema.profiles, eq(schema.profiles.userId, schema.user.id))
    .where(eq(schema.user.id, userId))
    .limit(1);
  return row ?? null;
}

export async function loadCardData(bookingId: string): Promise<CardData | null> {
  const database = db();
  const [booking] = await database.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId)).limit(1);
  if (!booking) return null;
  const [[upload], [printer], owner, decidedBy] = await Promise.all([
    database
      .select({ originalName: schema.uploads.originalName, summary: schema.uploads.summary })
      .from(schema.uploads)
      .where(eq(schema.uploads.id, booking.uploadId))
      .limit(1),
    database.select({ model: schema.printers.model }).from(schema.printers).where(eq(schema.printers.id, booking.printerId)).limit(1),
    person(booking.ownerId),
    person(booking.decidedBy),
  ]);
  return {
    booking,
    owner: owner ?? { name: "Unknown member", username: null, discordId: null },
    decidedBy,
    upload: upload ?? null,
    printerModel: printer?.model ?? "",
  };
}

export async function renderCardFor(bookingId: string): Promise<MessagePayload | null> {
  const data = await loadCardData(bookingId);
  return data ? renderCard(data, { live: isLive(), siteOrigin: siteOrigin() }) : null;
}

/** A display name for log lines: a mention when live, @username otherwise. */
export async function actorLabel(userId: string | null) {
  if (!userId) return "PrintQ";
  const found = await person(userId);
  if (!found) return "someone";
  return isLive() && found.discordId ? `<@${found.discordId}>` : found.username ? `@${found.username}` : found.name;
}

/** Re-renders a booking's card (posting it the first time), optionally logs a line in its thread, then refreshes the boards. Never throws. */
export async function syncBooking(bookingId: string, logLine?: string) {
  try {
    const data = await loadCardData(bookingId);
    if (data) {
      const payload = renderCard(data, { live: isLive(), siteOrigin: siteOrigin() });
      const row = await deliver("card", bookingId, payload, {
        channelId: printqEnv().PRINTQ_ADMIN_CHANNEL_ID,
        thread: `${data.booking.title ?? "Print"} · ${data.owner.username ?? data.owner.name}`,
      });
      if (logLine) await logToCard(bookingId, row, logLine);
    }
  } catch (error) {
    console.error("PrintQ: card sync failed", error);
  }
  await syncBoards();
}

async function logToCard(bookingId: string, row: MessageRow | null, line: string) {
  const database = db();
  const [log] = await database
    .insert(schema.notifications)
    .values({ kind: "card_log", bookingId, channelId: row?.threadId ?? null, title: line, body: "" })
    .returning({ id: schema.notifications.id });
  if (!isLive() || !row?.threadId) return;
  try {
    await discordFetch(`/channels/${row.threadId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: line, allowed_mentions: { parse: [] } }),
    });
    await database.update(schema.notifications).set({ delivery: "discord" }).where(eq(schema.notifications.id, log.id));
  } catch (error) {
    await database
      .update(schema.notifications)
      .set({ delivery: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "unknown" })
      .where(eq(schema.notifications.id, log.id));
  }
}

// --- Boards ---

async function boardPrinter() {
  const [printer] = await db()
    .select()
    .from(schema.printers)
    .where(ne(schema.printers.status, "retired"))
    .orderBy(asc(schema.printers.createdAt))
    .limit(1);
  return printer ?? null;
}

export async function loadBoardData(now = new Date()): Promise<BoardData | null> {
  const printer = await boardPrinter();
  if (!printer) return null;
  const database = db();
  const today = localDateOf(now, PRINTQ_TIMEZONE);
  const horizon = fromLocal({ ...addLocalDays(today, 8), hour: 0, minute: 0 }, PRINTQ_TIMEZONE);
  const dayStart = fromLocal({ ...today, hour: 0, minute: 0 }, PRINTQ_TIMEZONE);

  const [lab, [printing], [{ pending }], upcoming, closures, hours] = await Promise.all([
    getLabStatus(),
    database
      .select({ title: schema.bookings.title, slot: schema.bookings.slot })
      .from(schema.bookings)
      .where(eq(schema.bookings.status, "printing"))
      .limit(1),
    database.select({ pending: sql<number>`count(*)::int` }).from(schema.bookings).where(eq(schema.bookings.status, "pending")),
    database
      .select({ title: schema.bookings.title, status: schema.bookings.status, slot: schema.bookings.slot })
      .from(schema.bookings)
      .where(
        and(
          inArray(schema.bookings.status, ["pending", "approved", "checked_in", "printing", "finished"]),
          sql`lower(${schema.bookings.slot}) >= ${dayStart.toISOString()}::timestamptz`,
          sql`lower(${schema.bookings.slot}) < ${horizon.toISOString()}::timestamptz`
        )
      )
      .orderBy(sql`lower(${schema.bookings.slot})`),
    database
      .select()
      .from(schema.closures)
      .where(sql`upper(${schema.closures.during}) > ${now.toISOString()}::timestamptz`)
      .orderBy(sql`lower(${schema.closures.during})`)
      .limit(25),
    database.select().from(schema.labHours).where(isNull(schema.labHours.printerId)),
  ]);

  // Today, then the next days that have lab hours or bookings: three in all.
  const days: BoardData["days"] = [];
  for (let offset = 0; offset < 8 && days.length < 3; offset++) {
    const date = addLocalDays(today, offset);
    const label = formatDay(fromLocal({ ...date, hour: 12, minute: 0 }, PRINTQ_TIMEZONE));
    const weekday = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
    const items = upcoming
      .filter((booking) => formatDay(booking.slot.start) === label)
      .map((booking) => ({ title: booking.title, status: booking.status, ...booking.slot }));
    if (offset > 0 && items.length === 0 && !hours.some((row) => row.weekday === weekday)) continue;
    days.push({ label: offset === 0 ? `Today · ${label}` : offset === 1 ? `Tomorrow · ${label}` : label, items });
  }

  return {
    printerName: printer.name,
    lab: { open: lab.open, since: lab.since },
    printing: printing ? { title: printing.title, end: printing.slot.end } : null,
    pendingCount: pending,
    days,
    closures: closures.map((closure) => ({ id: closure.id, kind: closure.kind, reason: closure.reason, ...closure.during })),
    hours: hours.map((row) => ({ weekday: row.weekday, opensAt: row.opensAt, closesAt: row.closesAt })),
    now,
  };
}

export async function renderBoardNow(): Promise<MessagePayload | null> {
  const data = await loadBoardData();
  return data ? renderBoard(data) : null;
}

/** Refreshes the staff board and the public board. Never throws. */
export async function syncBoards() {
  try {
    const board = await renderBoardNow();
    if (board) await deliver("board", null, board, { channelId: printqEnv().PRINTQ_ADMIN_CHANNEL_ID, pin: true });

    const publicChannel = printqEnv().PRINTQ_PUBLIC_CHANNEL_ID;
    const printer = await boardPrinter();
    if (printer && (publicChannel || !isLive())) {
      const now = new Date();
      const [calendar, lab] = await Promise.all([
        loadCalendar(printer.id, { start: now, end: new Date(now.getTime() + 7 * 86_400_000) }),
        getLabStatus(),
      ]);
      await deliver("public_board", null, renderPublicBoard({ printerName: printer.name, calendar, lab, siteOrigin: siteOrigin(), now }), {
        channelId: publicChannel,
        pin: true,
      });
    }
  } catch (error) {
    console.error("PrintQ: board sync failed", error);
  }
}

/** /printstaff board: drop the stored board (deleting the old message if we can) and post a fresh one. */
export async function repostBoard() {
  const [existing] = await db().select().from(schema.discordMessages).where(eq(schema.discordMessages.kind, "board")).limit(1);
  if (existing) {
    if (isLive() && existing.channelId !== "demo") {
      await discordFetch(`/channels/${existing.channelId}/messages/${existing.messageId}`, { method: "DELETE" }).catch(() => undefined);
    }
    await db().delete(schema.discordMessages).where(eq(schema.discordMessages.id, existing.id));
  }
  await syncBoards();
}

/** For the demo preview: every stored message, boards first, newest cards first. */
export async function listStoredMessages() {
  return db()
    .select()
    .from(schema.discordMessages)
    .orderBy(sql`case ${schema.discordMessages.kind} when 'board' then 0 when 'public_board' then 1 else 2 end`, sql`${schema.discordMessages.createdAt} desc`);
}

export async function cardLogs(bookingIds: string[]) {
  if (bookingIds.length === 0) return [];
  return db()
    .select({ bookingId: schema.notifications.bookingId, line: schema.notifications.title, at: schema.notifications.createdAt })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.kind, "card_log"), inArray(schema.notifications.bookingId, bookingIds)))
    .orderBy(asc(schema.notifications.id));
}
