/**
 * Format an agent ingest SSE event into a single Docker-style log line, the
 * way the ingest log viewer expects. Port of TTT `pipeline/runner.py
 * _format_event`. Markers: ▶ start · ✓ finish · ✗ error · → tool call ·
 * ← tool result · ~ agent text · ✎ page write · · info.
 *
 * Server-only (used by the ingest runner) but pure — safe anywhere.
 */

export type IngestEventType =
  | "log"
  | "tool_call"
  | "tool_result"
  | "page_written"
  | "done"
  | "error";

export interface IngestEvent {
  type: IngestEventType;
  data: Record<string, unknown>;
}

function hhmmss(): string {
  // Pure (no Date.now needed for value, just current wall clock for display).
  return new Date().toISOString().slice(11, 19);
}

function ts(data: Record<string, unknown>): string {
  const raw = data.ts;
  if (typeof raw === "string" && raw) {
    // Accept ISO or HH:MM:SS; show just the time part for compactness.
    const m = raw.match(/\d{2}:\d{2}:\d{2}/);
    return m ? m[0] : raw;
  }
  return hhmmss();
}

export function formatIngestEvent(ev: IngestEvent): string {
  const d = ev.data ?? {};
  const t = ts(d);
  switch (ev.type) {
    case "log":
      return `[${t}] ${String(d.line ?? "")}`;
    case "tool_call": {
      const input =
        d.input === undefined ? "" : typeof d.input === "string" ? d.input : JSON.stringify(d.input);
      return `[${t}] → ${String(d.tool ?? "?")} ${input}`.trimEnd();
    }
    case "tool_result": {
      const marker = d.is_error ? "✗" : "←";
      return `[${t}] ${marker} ${String(d.label ?? "?")} returned`;
    }
    case "page_written":
      return `[${t}] ✎ wrote ${String(d.path ?? "?")} (${Number(d.bytes ?? 0)} bytes)`;
    case "done": {
      const cost =
        typeof d.cost_usd === "number" ? `$${d.cost_usd.toFixed(4)}` : "?";
      return `[${t}] ✓ agent finished (subtype=${String(d.subtype ?? "?")}, turns=${String(
        d.turns ?? "?",
      )}, tool_calls=${String(d.tool_calls ?? "?")}, cost=${cost})`;
    }
    case "error":
      return `[${t}] ✗ ${String(d.message ?? "?")}`;
    default:
      return `[${t}] ${ev.type}: ${JSON.stringify(d)}`;
  }
}

/** A start-of-run line written by the runner before the agent dispatches. */
export function dispatchLine(isGreenfield: boolean): string {
  return `[${hhmmss()}] ▶ agent ingest dispatched (mode=${isGreenfield ? "greenfield" : "incremental"})`;
}

/** Info line (· marker). */
export function infoLine(text: string): string {
  return `[${hhmmss()}] · ${text}`;
}
