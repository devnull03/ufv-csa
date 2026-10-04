import "server-only";
import {
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  type APIInteraction,
  type APIInteractionResponse,
} from "discord-api-types/v10";
import { NextResponse } from "next/server";
import { isPrintQEnabled, siteOrigin } from "../env";
import { PRINT_COMMAND_NAME, PRINTQ_CUSTOM_ID_PREFIX } from "./commands";

export function isPrintQInteraction(interaction: APIInteraction): boolean {
  if (!isPrintQEnabled()) return false;
  switch (interaction.type) {
    case InteractionType.ApplicationCommand:
    case InteractionType.ApplicationCommandAutocomplete:
      return interaction.data.name === PRINT_COMMAND_NAME;
    case InteractionType.MessageComponent:
    case InteractionType.ModalSubmit:
      return interaction.data.custom_id.startsWith(PRINTQ_CUSTOM_ID_PREFIX);
    default:
      return false;
  }
}

const ephemeral = (content: string): APIInteractionResponse => ({
  type: InteractionResponseType.ChannelMessageWithSource,
  data: { content, flags: MessageFlags.Ephemeral },
});

/**
 * Entry point called from app/(site)/api/webhooks/discord/interact/route.ts after
 * signature verification. Must answer within 3 seconds: reply inline for cheap
 * reads, otherwise defer (type 5/6) and finish the work in `after()`.
 */
export async function handlePrintQInteraction(interaction: APIInteraction): Promise<NextResponse> {
  // TODO(phase 3): /print schedule, /print mine, /print cancel, approve/reject buttons + reject modal.
  if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
    return NextResponse.json({ type: InteractionResponseType.ApplicationCommandAutocompleteResult, data: { choices: [] } });
  }
  return NextResponse.json(
    ephemeral(`PrintQ on Discord is coming soon. Book and manage prints at ${siteOrigin()}/printing`)
  );
}
