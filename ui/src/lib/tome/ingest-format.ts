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
  | "usage"
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

/** 1234 → "1.2k". Sub-1k stays exact. */
function kfmt(n: unknown): string {
  const v = Number(n ?? 0);
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v);
}

/**
 * Compact token summary from a cumulative usage block ({output, input}). Leads
 * with output (the expensive half). Returns "" when there's nothing to show.
 * Only additive fields are shown — cache reads re-count the same prefix each
 * turn, so a cumulative "cached" figure is misleading and deliberately omitted.
 */
export function formatTokens(
  t: Record<string, unknown> | undefined | null,
): string {
  if (!t) return "";
  const parts: string[] = [];
  if (t.output != null) parts.push(`${kfmt(t.output)} out`);
  if (t.input != null) parts.push(`${kfmt(t.input)} in`);
  return parts.join(" · ");
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
    case "usage":
      // Usage snapshots drive the run header, not the log — the runner routes
      // them to run state before this formatter is reached. Empty = no line.
      return "";
    case "done": {
      const cost =
        typeof d.cost_usd === "number" ? `$${d.cost_usd.toFixed(4)}` : "?";
      const tokens = formatTokens(d.tokens as Record<string, unknown> | undefined);
      const tokenPart = tokens ? `, tokens=(${tokens})` : "";
      return `[${t}] ✓ agent finished (subtype=${String(d.subtype ?? "?")}, turns=${String(
        d.turns ?? "?",
      )}, tool_calls=${String(d.tool_calls ?? "?")}, cost=${cost}${tokenPart})`;
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
