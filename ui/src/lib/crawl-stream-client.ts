/**
 * Client-side NDJSON stream consumer for the Crawl Console.
 *
 * Wraps a fetch + stream-reader loop that parses one JSON event
 * per line and pushes events into the global crawl-console store.
 * Decoupled from the React tree so the store keeps receiving
 * events even while the user navigates between admin tabs (the
 * fetch lives at the app shell level, not inside the dialog).
 *
 * # Why a tiny dedicated module
 *
 * Three concerns the store doesn't want to know about:
 *
 *   1. Fetch lifecycle (Accept header, AbortController, errors).
 *   2. NDJSON line buffering (a single TCP read may contain
 *      multiple lines OR half a line).
 *   3. Failure semantics: distinguish a stream that closed after
 *      a terminal `done`/`error` event (good) from one that
 *      closed without one (broken_stream -- network drop).
 *
 * The store stays a pure state container; this module owns the
 * I/O. Tests can substitute a fake `fetch` and assert events
 * land in the store via the same mechanism the dialog uses.
 */

import type { CrawlEvent } from "@/lib/crawl-events";
import { useCrawlConsoleStore } from "@/store/crawl-console-store";

/**
 * Generate a stable per-run id. Crypto-random when available
 * (browsers + Node 19+), falls back to Date.now()+random for
 * older test runners. Not security-sensitive -- we just need
 * uniqueness across the dialog's lifetime.
 */
export function newRunId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `run_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export interface StartCrawlStreamOptions {
  /** HTTP endpoint to POST against -- the streaming branch on
   * /api/skill-hubs/crawl or /api/skill-hubs/[id]/refresh. */
  url: string;
  /** Request body forwarded as JSON. */
  body?: unknown;
  /**
   * Display label for the run-list entry. Caller is expected to
   * pass something operator-friendly (``Preview - acme/tools``,
   * ``Refresh - skills-marketplace``).
   */
  label: string;
  /** Whether this is the initial preview crawl or a force-refresh. */
  kind: "preview" | "refresh";
}

/**
 * Kick off a crawl stream and feed events into the global store.
 *
 * Returns the run id immediately (not the eventual result) so the
 * caller can pop open the dialog or attach extra UI without
 * awaiting the entire stream. The stream itself runs detached;
 * the store updates as events arrive.
 */
export function startCrawlStream(
  options: StartCrawlStreamOptions,
): { runId: string } {
  const runId = newRunId();
  const abort = new AbortController();
  const store = useCrawlConsoleStore.getState();

  store.startRun({
    id: runId,
    label: options.label,
    kind: options.kind,
    abort,
  });

  // Fire-and-forget: the run lifecycle is owned by the store now,
  // and any caller that needs to know "did it succeed" can read
  // ``runs.find(r => r.id === runId).status``.
  void consumeStream(runId, options, abort).catch((err) => {
    // consumeStream traps its own errors; this catch is a
    // last-resort safety net so an unexpected synchronous throw
    // doesn't leave the run flagged as ``running`` forever.
    console.error("[CrawlStream] Unhandled error in consumer:", err);
    useCrawlConsoleStore.getState().finishRun(runId, "broken_stream");
  });

  return { runId };
}

/**
 * The actual fetch + read loop. Splits into a separate function
 * because TypeScript narrows AbortController error handling
 * better when the body is an explicit ``async`` function rather
 * than an inline arrow.
 */
async function consumeStream(
  runId: string,
  options: StartCrawlStreamOptions,
  abort: AbortController,
): Promise<void> {
  const store = useCrawlConsoleStore.getState();

  let response: Response;
  try {
    response = await fetch(options.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Trigger the streaming branch via content negotiation
        // (commit 3). Without this header the server returns the
        // default JSON-shape response and the run would fail to
        // produce events.
        Accept: "application/x-ndjson",
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: abort.signal,
    });
  } catch (err) {
    if (abort.signal.aborted) {
      // User cancelled -- finishRun was already called by
      // store.cancelRun, but call again defensively in case
      // the abort fired before startRun's controller was
      // wired up.
      store.finishRun(runId, "aborted");
      return;
    }
    // Network error before we even got a response.
    store.appendEvent(runId, {
      type: "error",
      code: "network",
      message: err instanceof Error ? err.message : String(err),
    });
    store.finishRun(runId, "failed");
    return;
  }

  if (!response.ok || !response.body) {
    // Server responded but with an error (e.g. 401, 503). Drain
    // the body for a hint and emit a synthetic error event so
    // the dialog renders a useful message instead of a silent
    // "broken_stream".
    let preview = "";
    try {
      preview = (await response.text()).slice(0, 1024);
    } catch {
      // ignored -- best-effort body read
    }
    store.appendEvent(runId, {
      type: "error",
      code:
        response.status === 401 || response.status === 403
          ? "auth_failed"
          : response.status === 404
            ? "not_found"
            : "internal",
      message: `HTTP ${response.status} ${response.statusText}`,
      ...(preview ? { hint: preview } : {}),
    });
    store.finishRun(runId, "failed");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawTerminal = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // NDJSON: split on \n, hold the last (possibly incomplete)
      // chunk in `buffer` for the next iteration.
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) {
          const event = parseEventLine(line);
          if (event) {
            store.appendEvent(runId, event);
            if (event.type === "done" || event.type === "error") {
              sawTerminal = true;
            }
          }
        }
        nl = buffer.indexOf("\n");
      }
    }
    // Flush any trailing line (server didn't terminate with \n).
    const tail = buffer.trim();
    if (tail) {
      const event = parseEventLine(tail);
      if (event) {
        store.appendEvent(runId, event);
        if (event.type === "done" || event.type === "error") {
          sawTerminal = true;
        }
      }
    }

    // Determine the run's terminal state. Order of checks:
    //   1. user aborted -> aborted
    //   2. saw a `done` -> succeeded
    //   3. saw an `error` -> failed
    //   4. neither -> broken_stream (network closed mid-stream)
    if (abort.signal.aborted) {
      store.finishRun(runId, "aborted");
      return;
    }
    if (!sawTerminal) {
      store.finishRun(runId, "broken_stream");
      return;
    }
    // Use the last terminal event's type to decide.
    const finalRun = useCrawlConsoleStore
      .getState()
      .runs.find((r) => r.id === runId);
    const lastTerminal = finalRun?.events
      .slice()
      .reverse()
      .find((e) => e.type === "done" || e.type === "error");
    if (lastTerminal?.type === "done") store.finishRun(runId, "succeeded");
    else store.finishRun(runId, "failed");
  } catch (err) {
    if (abort.signal.aborted) {
      store.finishRun(runId, "aborted");
      return;
    }
    store.appendEvent(runId, {
      type: "error",
      code: "network",
      message: err instanceof Error ? err.message : String(err),
    });
    store.finishRun(runId, "broken_stream");
  }
}

/**
 * Parse a single NDJSON line into a CrawlEvent. Tolerant: lines
 * that don't parse or don't carry a ``type`` field are dropped
 * silently. The server-side encoder guarantees well-formed JSON,
 * but a misbehaving proxy injecting heartbeats could otherwise
 * break the entire stream.
 */
function parseEventLine(line: string): CrawlEvent | null {
  try {
    const parsed = JSON.parse(line);
    if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
      return parsed as CrawlEvent;
    }
  } catch {
    // Malformed line -- skip rather than fail the stream.
  }
  return null;
}
