/**
 * Serialize AG-UI events to W3C Server-Sent Events frames (same wire format as
 * dynamic_agents/services/stream_encoders/agui_sse.py and the chat AG-UI adapter).
 */

function dataLinesForPayload(jsonLine: string): string {
  if (!jsonLine.includes("\n")) {
    return `data: ${jsonLine}`;
  }
  return jsonLine
    .split("\n")
    .map((line) => `data: ${line}`)
    .join("\n");
}

/**
 * One SSE event frame: `event:` line + `data:` JSON + blank line.
 */
export function formatAgUiSseFrame(
  eventType: string,
  payload: Record<string, unknown>
): string {
  const payloadWithType = { type: eventType, ...payload };
  const jsonLine = JSON.stringify(payloadWithType);
  return `event: ${eventType}\n${dataLinesForPayload(jsonLine)}\n\n`;
}
