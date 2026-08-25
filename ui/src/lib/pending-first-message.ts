/**
 * One-shot handoff for the Home page hero composer: it creates a conversation
 * and navigates to it before a message can be sent (ChatPanel only exists once
 * a conversation id is in the URL), so the typed text is stashed here and
 * picked up by ChatPanel on mount instead of duplicating the send pipeline.
 */

let pending: { conversationId: string; text: string } | null = null;

export function setPendingFirstMessage(conversationId: string, text: string): void {
  pending = { conversationId, text };
}

/** Returns and clears the pending message if it matches this conversation. */
export function takePendingFirstMessage(conversationId: string): string | null {
  if (pending?.conversationId !== conversationId) return null;
  const { text } = pending;
  pending = null;
  return text;
}
