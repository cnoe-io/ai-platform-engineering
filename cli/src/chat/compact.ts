/**
 * LLM-backed conversation compact (/compact).
 */

export interface HistoryLine {
  role: "user" | "assistant";
  content: string;
}

export async function compactHistoryViaAgent(
  history: HistoryLine[],
  summarize: (prompt: string) => Promise<string>,
): Promise<HistoryLine[]> {
  if (history.length <= 2) return history;

  const transcript = history
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");

  const prompt =
    "Summarize the following conversation into a concise briefing for continuing work. " +
    "Preserve decisions, open tasks, file paths, and errors. Use markdown bullets.\n\n" +
    transcript;

  const summary = await summarize(prompt.trim());
  return [
    {
      role: "assistant",
      content: `_Conversation compacted_\n\n${summary.trim()}`,
    },
  ];
}
