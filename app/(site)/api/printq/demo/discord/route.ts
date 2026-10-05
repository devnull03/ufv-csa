import { InteractionResponseType, InteractionType } from "discord-api-types/v10";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import z from "zod";
import { disabledResponse } from "~/app/printq/api";
import { db, schema } from "~/app/printq/db/client";
import { respond } from "~/app/printq/discord/handlers";
import { isDemoMode } from "~/app/printq/env";
import { requireApiViewer } from "~/app/printq/viewer";

export const dynamic = "force-dynamic";

const source = z
  .object({
    messageId: z.string().uuid().optional(), // a stored bot message (card or board)
    notificationId: z.number().int().optional(), // a DM in the outbox
    transient: z.object({ embeds: z.array(z.unknown()), components: z.array(z.unknown()) }).optional(), // an ephemeral reply
  })
  .default({});

const body = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("component"), customId: z.string().max(100), values: z.array(z.string()).max(25).default([]), source }),
  z.object({ kind: z.literal("modal"), customId: z.string().max(100), fields: z.record(z.string().max(4000)), source }),
  z.object({
    kind: z.literal("command"),
    name: z.enum(["print", "printstaff"]),
    sub: z.string().max(32),
    options: z.array(z.object({ name: z.string(), type: z.number(), value: z.union([z.string(), z.number(), z.boolean()]) })).default([]),
  }),
]);

/**
 * Demo mode: the staff "Discord preview" sends clicks, form submits and slash
 * commands here. We build the interaction Discord would send and run it
 * through the real handler, so the preview tests the same code path.
 */
export async function POST(request: Request) {
  const disabled = disabledResponse();
  if (disabled) return disabled;
  const { viewer, error } = await requireApiViewer("staff");
  if (error) return error;
  if (!isDemoMode()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const input = parsed.data;

  // Who is clicking: the signed-in staff member in the server, or, for a DM, the member it was sent to.
  let actor: Record<string, unknown> = {
    member: { user: { id: viewer.discordId, username: viewer.discordUsername ?? viewer.name, global_name: viewer.name }, roles: [], nick: viewer.name },
  };
  let message: { id: string; embeds: unknown[]; components: unknown[] } | undefined;
  if (input.kind !== "command") {
    if (input.source.messageId) {
      const [row] = await db().select().from(schema.discordMessages).where(eq(schema.discordMessages.id, input.source.messageId)).limit(1);
      if (row) message = { id: row.messageId, ...row.payload };
    } else if (input.source.notificationId) {
      const [row] = await db().select().from(schema.notifications).where(eq(schema.notifications.id, input.source.notificationId)).limit(1);
      if (!row?.recipientDiscordId) return NextResponse.json({ error: "not_found" }, { status: 404 });
      actor = { user: { id: row.recipientDiscordId, username: "member" } };
      message = { id: `dm-${row.id}`, embeds: [{ title: row.title, description: row.body }], components: row.components ?? [] };
    } else if (input.source.transient) {
      message = { id: "ephemeral", ...input.source.transient };
    }
  }

  const base = { id: "demo", application_id: "demo", token: "demo", version: 1, ...actor };
  const interaction =
    input.kind === "component"
      ? {
          ...base,
          type: InteractionType.MessageComponent,
          data: { custom_id: input.customId, component_type: input.values.length ? 3 : 2, values: input.values },
          message: message ?? { id: "unknown", embeds: [], components: [] },
        }
      : input.kind === "modal"
        ? {
            ...base,
            type: InteractionType.ModalSubmit,
            data: {
              custom_id: input.customId,
              components: Object.entries(input.fields).map(([custom_id, value]) => ({ type: 1, components: [{ type: 4, custom_id, value }] })),
            },
            message,
          }
        : {
            ...base,
            type: InteractionType.ApplicationCommand,
            data: { type: 1, name: input.name, options: [{ type: 1, name: input.sub, options: input.options }] },
          };

  const response = await respond(interaction as never);

  // Like Discord: an "update message" response replaces the message that was clicked.
  if (response.type === InteractionResponseType.UpdateMessage && input.kind !== "command") {
    const data = response.data as { content?: string; embeds?: unknown[]; components?: unknown[] };
    if (input.source.notificationId) {
      await db()
        .update(schema.notifications)
        .set({ components: data.components ?? [] })
        .where(eq(schema.notifications.id, input.source.notificationId));
    } else if (input.source.messageId) {
      await db()
        .update(schema.discordMessages)
        .set({ payload: { content: data.content || undefined, embeds: data.embeds ?? [], components: data.components ?? [] } as never, updatedAt: new Date() })
        .where(eq(schema.discordMessages.id, input.source.messageId));
    }
  }
  return NextResponse.json(response);
}
