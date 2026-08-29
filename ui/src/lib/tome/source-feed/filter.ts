/** Pure label filtering for GitHub source events stored in Mycelium messages. */

interface SourceEventMessage {
  message_type: string;
  metadata?: Record<string, unknown> | null;
}

export function isGithubSourceEvent(message: SourceEventMessage): boolean {
  if (message.message_type !== "event") return false;
  const metadata = message.metadata;
  if (metadata?.kind !== "source_event") return false;
  const payload = metadata.payload;
  return Boolean(
    payload &&
      typeof payload === "object" &&
      (payload as { source?: unknown }).source === "github",
  );
}

export function sourceEventLabels(message: SourceEventMessage): string[] {
  if (!isGithubSourceEvent(message)) return [];
  const metadata = message.metadata as Record<string, unknown>;
  const payload = metadata.payload;
  if (!payload || typeof payload !== "object") return [];
  const labels = (payload as { labels?: unknown }).labels;
  return Array.isArray(labels)
    ? labels.filter((label): label is string => typeof label === "string")
    : [];
}

export function sourceEventMatchesLabel(
  message: SourceEventMessage,
  label: string,
): boolean {
  if (label === "all") return true;
  const normalized = label.trim().toLowerCase();
  return sourceEventLabels(message).some(
    (candidate) => candidate.trim().toLowerCase() === normalized,
  );
}
