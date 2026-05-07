import type { Conversation } from "@/types/a2a";

type ConversationSharing = Conversation["sharing"];

export function buildChatClientContext(
  sharing?: ConversationSharing,
  extraClientContext?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    source: "webui",
    ...(sharing && { chat_sharing: sharing }),
    ...(extraClientContext ?? {}),
  };
}
