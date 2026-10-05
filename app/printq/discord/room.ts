import "server-only";
import { isPrintQEnabled } from "../env";
import { setLabStatus, usesLocalLabStatus } from "../lab-status";
import { onRoomStatusChange } from "../room-status";

function localMode() {
  try {
    return isPrintQEnabled() && usesLocalLabStatus();
  } catch {
    return false;
  }
}

/**
 * Opens or closes the lab. Shared by the existing /sccroom command and the
 * PrintQ staff board's lab button, so both do exactly the same thing: rename
 * the room channel, post in it, save the status to Sanity, then run the PrintQ
 * hook (lab-opened DMs, board refresh). Without Sanity (demo mode) PrintQ keeps
 * the status itself.
 */
export async function setRoomStatus(input: { open: boolean; discordUserId: string; actorUserId?: string | null }) {
  if (localMode()) {
    await setLabStatus(input.open, input.actorUserId ?? null);
    return;
  }

  // Imported lazily: these modules need Sanity and bot credentials at import time.
  const [{ discordAPIRest }, { writeServerClient }, { revalidatePath, revalidateTag }, config, { Routes }, { v4: uuidv4 }] = await Promise.all([
    import("~/app/(site)/api/utils"),
    import("~/app/(site)/serverClient"),
    import("next/cache"),
    import("~/app/(site)/config"),
    import("discord-api-types/v10"),
    import("uuid"),
  ]);
  const roomItems = input.open ? { emoji: "🔓", statusPastTense: "opened" } : { emoji: "🔐", statusPastTense: "closed" };
  const channelId = process.env.DISCORD_SCC_ROOM_CHANNEL_ID!;

  await discordAPIRest.patch(Routes.channel(channelId), {
    body: { name: `${roomItems.emoji} ${input.open ? "open" : "closed"}` },
  });
  const siteHost = `http${process.env.NODE_ENV === "development" ? "" : "s"}://${process.env.SITE_DOMAIN}`;
  await Promise.all([
    // https://docs.discord.com/developers/resources/message#create-message
    discordAPIRest.post(Routes.channelMessages(channelId), {
      body: {
        // Discord nonces are capped at 25 characters.
        nonce: uuidv4().substring(0, 25),
        enforce_nonce: true,
        embeds: [
          {
            description: `${roomItems.emoji}: <@${input.discordUserId}> has ${roomItems.statusPastTense} the [${config.AppRoomName}](${siteHost}/scc)`,
            color: config.AppLogoBlendedGreenDecimal,
            image: { url: `${siteHost}/CSA_SCC_Room_${input.open ? "Open" : "Closed"}.png` },
          },
        ],
      },
    }),
    writeServerClient.create({ _type: "roomStatus", discordUserId: input.discordUserId, status: input.open }),
  ]);
  await onRoomStatusChange(input.open);
  revalidateTag("roomStatus");
  revalidatePath("/api/room-status", "page");
}
