import "server-only";
import type { APIActionRowComponent, APIMessageActionRowComponent, APIEmbed } from "discord-api-types/v10";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { AppLogoBlendedGreenDecimal } from "~/app/(site)/config";
import { PRINTQ_TIMEZONE } from "./constants";
import { db, schema } from "./db/client";
import { memberButtons } from "./discord/render";
import { discordFetch } from "./discord/rest";
import { actorLabel, syncBoards, syncBooking } from "./discord/sync";
import { discordBotConfigured, printqEnv, siteOrigin } from "./env";
import { formatDay, formatDuration, formatSlot, formatTime } from "./format";
import type { BookingAction } from "./scheduling/state-machine";
import { addLocalDays, fromLocal, localDateOf } from "./scheduling/time";

type Booking = typeof schema.bookings.$inferSelect;

interface Message {
  kind: string;
  bookingId?: string;
  title: string;
  body: string;
  dedupeKey?: string;
  components?: APIActionRowComponent<APIMessageActionRowComponent>[];
}

/**
 * Notification hooks. Every message is recorded in printq.notifications. When
 * the Discord bot is configured (and PRINTQ_DEMO is off) it is also delivered:
 * DMs to members, and posts to the admin channel. Otherwise the row stays in
 * the "outbox", which staff can read on the dashboard. Never throws.
 */
async function send(target: { userId: string } | { adminChannel: true }, message: Message) {
  try {
    const database = db();
    let recipientDiscordId: string | null = null;
    const channelId = "adminChannel" in target ? printqEnv().PRINTQ_ADMIN_CHANNEL_ID ?? null : null;
    if ("userId" in target) {
      const [profile] = await database
        .select({ discordId: schema.profiles.discordId })
        .from(schema.profiles)
        .where(eq(schema.profiles.userId, target.userId))
        .limit(1);
      recipientDiscordId = profile?.discordId ?? null;
    }
    const [row] = await database
      .insert(schema.notifications)
      .values({
        kind: message.kind,
        bookingId: message.bookingId ?? null,
        recipientUserId: "userId" in target ? target.userId : null,
        recipientDiscordId,
        channelId,
        title: message.title,
        body: message.body,
        dedupeKey: message.dedupeKey ?? null,
        components: message.components ?? null,
      })
      .onConflictDoNothing({ target: schema.notifications.dedupeKey })
      .returning({ id: schema.notifications.id });
    if (!row || !discordBotConfigured()) return; // duplicate, or outbox only

    const embed: APIEmbed = {
      title: message.title,
      description: message.body,
      color: AppLogoBlendedGreenDecimal,
      url: message.bookingId ? `${siteOrigin()}/printing/me/${message.bookingId}` : undefined,
    };
    try {
      let targetChannel = channelId;
      if (recipientDiscordId) {
        const dm = await discordFetch<{ id: string }>("/users/@me/channels", {
          method: "POST",
          body: JSON.stringify({ recipient_id: recipientDiscordId }),
        });
        targetChannel = dm.id;
      }
      if (!targetChannel) throw new Error("No Discord destination");
      await discordFetch(`/channels/${targetChannel}/messages`, {
        method: "POST",
        body: JSON.stringify({ embeds: [embed], components: message.components ?? [] }),
      });
      await database.update(schema.notifications).set({ delivery: "discord" }).where(eq(schema.notifications.id, row.id));
    } catch (error) {
      await database
        .update(schema.notifications)
        .set({ delivery: "failed", error: error instanceof Error ? error.message.slice(0, 500) : "unknown" })
        .where(eq(schema.notifications.id, row.id));
    }
  } catch (error) {
    console.error("PrintQ notification failed", error);
  }
}

const bookingLink = (id: string) => `${siteOrigin()}/printing/me/${id}`;
const title = (booking: Booking) => booking.title ?? "Your print";

export async function onBookingRequested(booking: Booking) {
  const slot = formatSlot(booking.slot.start, booking.slot.end);
  await send(
    { userId: booking.ownerId },
    {
      kind: "request_received",
      bookingId: booking.id,
      title: "Request received",
      body: `**${title(booking)}** is pending approval for ${slot}. We'll message you as soon as staff review it.`,
    }
  );
  // The staff channel gets a card that is edited for the rest of the booking's life.
  await syncBooking(booking.id, `📥 Requested by ${await actorLabel(booking.ownerId)}`);
}

const DECISION_COPY: Partial<Record<BookingAction, (booking: Booking, note?: string) => { title: string; body: string }>> = {
  approve: (booking) => ({
    title: "Print approved",
    body: `**${title(booking)}** is confirmed for ${formatSlot(booking.slot.start, booking.slot.end)}. Come to D224 at the start of your slot.`,
  }),
  reject: (booking, note) => ({
    title: "Print declined",
    body: `**${title(booking)}** was declined${note ? `: ${note}` : "."} You can upload a new file and book again.`,
  }),
  cancel: (booking, note) => ({ title: "Booking cancelled", body: `Staff cancelled **${title(booking)}**${note ? `: ${note}` : "."}` }),
  finish: (booking) => ({ title: "Ready for pickup", body: `**${title(booking)}** is done. Grab it from D224 during lab hours.` }),
  fail: (booking, note) => ({
    title: "Print failed",
    body: `Sorry, **${title(booking)}** failed${note ? `: ${note}` : "."} Book again whenever you're ready.`,
  }),
  no_show: (booking) => ({ title: "Missed slot", body: `We marked **${title(booking)}** as a no-show. Book again if you still need it.` }),
  lab_closed: (booking, note) => ({
    title: "Lab closed",
    body: `The lab is closed for **${title(booking)}**${note ? ` (${note})` : ""}. Sorry about that; please book a new time.`,
  }),
};

/** One line per change in the card's thread. */
function logLine(action: BookingAction, actor: string, isOwner: boolean, note?: string) {
  const why = note ? `: ${note}` : "";
  switch (action) {
    case "approve":
      return `✅ Approved by ${actor}`;
    case "reject":
      return `❌ Declined by ${actor}${why}`;
    case "cancel":
      return isOwner ? "🚫 Cancelled by the member" : `🚫 Cancelled by ${actor}${why}`;
    case "check_in":
      return `📍 Checked in by ${actor}`;
    case "start":
      return `🖨️ Print started by ${actor}`;
    case "finish":
      return `🏁 Finished · ${actor}`;
    case "fail":
      return `⚠️ Failed · ${actor}${why}`;
    case "collect":
      return `📦 Collected · ${actor}`;
    case "no_show":
      return `👻 No-show · ${actor}`;
    case "lab_closed":
      return `🔒 Lab closed${why}`;
    case "expire":
      return "⌛ Hold expired before anyone reviewed it";
  }
}

export async function onBookingTransition(booking: Booking, action: BookingAction, actorUserId: string | null, note?: string) {
  const isOwner = actorUserId === booking.ownerId;
  await syncBooking(booking.id, logLine(action, await actorLabel(actorUserId), isOwner, note));
  const copy = DECISION_COPY[action];
  // Members don't need a message about their own cancellation.
  if (!copy || (action === "cancel" && isOwner)) return;
  const { title: heading, body } = copy(booking, note);
  await send(
    { userId: booking.ownerId },
    {
      kind: `booking_${action}`,
      bookingId: booking.id,
      title: heading,
      body: `${body}\n${bookingLink(booking.id)}`,
      components: action === "approve" ? memberButtons("cancel", booking.id) : undefined,
    }
  );
}

/** Staff moved a booking: log it on the card and ask the member to keep or cancel. */
export async function onBookingMoved(booking: Booking, from: Booking["slot"], actorUserId: string) {
  await syncBooking(booking.id, `🕒 Moved by ${await actorLabel(actorUserId)} from ${formatSlot(from.start, from.end)}`);
  await send(
    { userId: booking.ownerId },
    {
      kind: "booking_moved",
      bookingId: booking.id,
      title: "Your print was moved",
      body: `Staff moved **${title(booking)}** to **${formatSlot(booking.slot.start, booking.slot.end)}** (was ${formatSlot(from.start, from.end)}).`,
      components: memberButtons("moved", booking.id),
    }
  );
}

/** Closures or lab hours changed. */
export async function onAvailabilityChanged() {
  await syncBoards();
}

export async function onHoldsExpired(bookingIds: string[]) {
  if (bookingIds.length === 0) return;
  const rows = await db().select().from(schema.bookings).where(inArray(schema.bookings.id, bookingIds));
  for (const booking of rows) {
    await send(
      { userId: booking.ownerId },
      {
        kind: "hold_expired",
        bookingId: booking.id,
        title: "Hold expired",
        body: `Staff didn't get to **${title(booking)}** in time, so the hold on ${formatSlot(booking.slot.start, booking.slot.end)} expired. Please book again.`,
        dedupeKey: `hold_expired:${booking.id}`,
      }
    );
    await syncBooking(booking.id, logLine("expire", "PrintQ", false));
  }
}

/** 24 h and 1 h reminders for approved bookings. Deduplicated, so safe to run every few minutes. */
export async function sendReminders(now = new Date()) {
  const upcoming = await db()
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.status, "approved"),
        sql`lower(${schema.bookings.slot}) > ${now.toISOString()}::timestamptz`,
        sql`lower(${schema.bookings.slot}) <= ${new Date(now.getTime() + 24 * 3_600_000).toISOString()}::timestamptz`
      )
    );
  let sent = 0;
  for (const booking of upcoming) {
    const minutesAway = (booking.slot.start.getTime() - now.getTime()) / 60_000;
    const window = minutesAway <= 60 ? "1h" : "24h";
    const sameDay = formatDay(booking.slot.start) === formatDay(now);
    await send(
      { userId: booking.ownerId },
      {
        kind: `reminder_${window}`,
        bookingId: booking.id,
        title: window === "1h" ? "Your print starts soon" : sameDay ? "Print later today" : "Print tomorrow",
        body: `**${title(booking)}** starts at ${formatTime(booking.slot.start)} (${formatSlot(booking.slot.start, booking.slot.end)}). Head to D224.`,
        dedupeKey: `reminder_${window}:${booking.id}`,
        components: memberButtons("cancel", booking.id),
      }
    );
    sent++;
  }
  return sent;
}

/** Lab-opened hook: tell members with approved bookings today. */
export async function onLabOpened(now = new Date()) {
  const today = localDateOf(now, PRINTQ_TIMEZONE);
  const dayStart = fromLocal({ ...today, hour: 0, minute: 0 }, PRINTQ_TIMEZONE);
  const dayEnd = fromLocal({ ...addLocalDays(today, 1), hour: 0, minute: 0 }, PRINTQ_TIMEZONE);
  const bookings = await db()
    .select()
    .from(schema.bookings)
    .where(
      and(
        eq(schema.bookings.status, "approved"),
        sql`lower(${schema.bookings.slot}) >= ${dayStart.toISOString()}::timestamptz`,
        sql`lower(${schema.bookings.slot}) < ${dayEnd.toISOString()}::timestamptz`
      )
    );
  for (const booking of bookings) {
    await send(
      { userId: booking.ownerId },
      {
        kind: "lab_opened",
        bookingId: booking.id,
        title: "The lab is open",
        body: `D224 is open. **${title(booking)}** starts at ${formatTime(booking.slot.start)}.`,
        dedupeKey: `lab_opened:${booking.id}:${today.year}-${today.month}-${today.day}`,
      }
    );
  }
  return bookings.length;
}

export async function recentNotifications(limit = 25) {
  return db()
    .select({
      id: schema.notifications.id,
      kind: schema.notifications.kind,
      title: schema.notifications.title,
      body: schema.notifications.body,
      delivery: schema.notifications.delivery,
      error: schema.notifications.error,
      createdAt: schema.notifications.createdAt,
      recipient: schema.user.name,
      recipientDiscordId: schema.notifications.recipientDiscordId,
      bookingId: schema.notifications.bookingId,
      components: schema.notifications.components,
      channelId: schema.notifications.channelId,
    })
    .from(schema.notifications)
    .leftJoin(schema.user, eq(schema.user.id, schema.notifications.recipientUserId))
    .where(ne(schema.notifications.kind, "card_log"))
    .orderBy(sql`${schema.notifications.id} desc`)
    .limit(limit);
}
