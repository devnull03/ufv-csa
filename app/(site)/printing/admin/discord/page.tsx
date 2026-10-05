import { and, desc, eq, inArray, isNotNull, ne } from "drizzle-orm";
import { db, schema } from "~/app/printq/db/client";
import { cardLogs, ensureCards, listStoredMessages } from "~/app/printq/discord/sync";
import { discordBotConfigured, isDemoMode, printqEnv } from "~/app/printq/env";
import { DiscordPreview, type DirectMessage, type StoredMessage } from "~/app/printq/ui/DiscordPreview";
import { requireRolePage } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Discord" };

// Demo mode: a clickable stand-in for the staff channel, public board and DMs.
// Live: where the bot posts, and links to its messages.
export default async function DiscordPage() {
  const viewer = await requireRolePage("staff", "/printing/admin/discord");

  if (!isDemoMode()) {
    const env = printqEnv();
    const messages = await listStoredMessages();
    const link = (channelId: string, messageId: string) => `https://discord.com/channels/${env.DISCORD_SERVER_ID}/${channelId}/${messageId}`;
    const board = messages.find((message) => message.kind === "board");
    const publicBoard = messages.find((message) => message.kind === "public_board");
    const rows: [string, string, string | null][] = [
      ["Bot", discordBotConfigured() ? "Connected" : "Not configured", null],
      ["Staff channel", env.PRINTQ_ADMIN_CHANNEL_ID ? "Set" : "Not set (PRINTQ_ADMIN_CHANNEL_ID)", null],
      ["Staff board", board ? "Posted and pinned" : "Not posted yet. Run /printstaff board", board ? link(board.channelId, board.messageId) : null],
      ["Public board", publicBoard ? "Posted and pinned" : env.PRINTQ_PUBLIC_CHANNEL_ID ? "Not posted yet" : "Off (PRINTQ_PUBLIC_CHANNEL_ID not set)", publicBoard ? link(publicBoard.channelId, publicBoard.messageId) : null],
      ["Request cards", String(messages.filter((message) => message.kind === "card").length), null],
      ["Staff role", env.PRINTQ_STAFF_ROLE_ID ? "Set: members with it can act from Discord" : "Not set: only people promoted in PrintQ", null],
    ];
    return (
      <>
        <div className="flex flex-col gap-1.5">
          <span className="pq-overline">PrintQ · Staff</span>
          <h2>Discord</h2>
        </div>
        <div className="pq-panel flex flex-col">
          {rows.map(([label, value, href], index) => (
            <div key={label} className={`flex flex-wrap gap-3 px-4 py-3 ${index ? "pq-rule-t" : ""}`}>
              <span className="pq-label w-40">{label}</span>
              {href ? (
                <a href={href} target="_blank" rel="noreferrer">
                  {value} ↗
                </a>
              ) : (
                <span>{value}</span>
              )}
            </div>
          ))}
        </div>
      </>
    );
  }

  await ensureCards();
  const stored = await listStoredMessages();
  const bookingIds = stored.filter((message) => message.bookingId).map((message) => message.bookingId!);
  const [logs, slots] = await Promise.all([
    cardLogs(bookingIds),
    bookingIds.length
      ? db().select({ id: schema.bookings.id, slot: schema.bookings.slot }).from(schema.bookings).where(inArray(schema.bookings.id, bookingIds))
      : Promise.resolve([]),
  ]);
  // Cards soonest first, so what's happening now is at the top.
  const startOf = new Map(slots.map((row) => [row.id, row.slot.start.getTime()]));
  stored.sort((a, b) => (a.bookingId && b.bookingId ? (startOf.get(a.bookingId) ?? 0) - (startOf.get(b.bookingId) ?? 0) : 0));
  const messages: StoredMessage[] = stored.map((message) => ({
    id: message.id,
    kind: message.kind,
    payload: message.payload as StoredMessage["payload"],
    logs: logs.filter((log) => log.bookingId === message.bookingId).map((log) => log.line),
  }));
  const dmRows = await db()
    .select({
      id: schema.notifications.id,
      to: schema.user.name,
      title: schema.notifications.title,
      body: schema.notifications.body,
      components: schema.notifications.components,
    })
    .from(schema.notifications)
    .innerJoin(schema.user, eq(schema.user.id, schema.notifications.recipientUserId))
    .where(and(isNotNull(schema.notifications.recipientUserId), ne(schema.notifications.kind, "card_log")))
    .orderBy(desc(schema.notifications.id))
    .limit(12);
  const dms: DirectMessage[] = dmRows.map((row) => ({ ...row, components: (row.components as DirectMessage["components"]) ?? null }));

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="pq-overline">PrintQ · Staff · Demo</span>
        <h2>Discord preview</h2>
        <p className="pq-soft max-w-[70ch]" style={{ textWrap: "pretty" }}>
          What the bot would post, live. Buttons, menus, forms and commands run the real Discord handler, so anything you do here
          changes PrintQ exactly as it would from Discord.
        </p>
      </div>
      <DiscordPreview messages={messages} dms={dms} viewerName={viewer.discordUsername ? `@${viewer.discordUsername}` : viewer.name} />
    </>
  );
}
