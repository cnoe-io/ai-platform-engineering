/**
 * Shared helper to return a Next.js ``Response`` whose body is an
 * NDJSON stream of crawl events.
 *
 * Used by both ``POST /api/skill-hubs/crawl`` (preview) and
 * ``POST /api/skill-hubs/[id]/refresh`` to surface live progress
 * to the admin UI's ``CrawlConsoleDialog`` (commit 5). The same
 * helper lets the refresh route also persist the encoded log on
 * the hub document for post-hoc inspection ("View last crawl").
 *
 * Why a separate helper
 * ---------------------
 *
 * The two routes share three concerns:
 *   1. Wire up an ``CrawlEventEmitter`` whose events go through
 *      the ``NdjsonStreamEncoder`` and into a ``ReadableStream``.
 *   2. Produce the canonical ``started``/``done``/``error`` event
 *      bookends so consumers can tell when a stream completed
 *      cleanly vs. dropped.
 *   3. Optionally tee the encoded bytes into an in-memory buffer
 *      for persistence (refresh path only — preview is ephemeral).
 *
 * Inlining all of that twice would invite the two routes to drift,
 * which is exactly the failure mode this commit is trying to
 * solve (consistent UX across preview and refresh).
 */

import { Buffer } from "node:buffer";
import {
  NOOP_EMITTER,
  type CrawlEvent,
  type CrawlEventEmitter,
  type CrawlErrorCode,
} from "@/lib/crawl-events";
import { NdjsonStreamEncoder } from "@/lib/crawl-stream";

/**
 * Cap on the number of events we persist to ``hub.last_crawl_log``
 * after a refresh. Sized below ``MAX_STREAM_EVENTS`` so the
 * persisted log always fits in one Mongo doc with comfortable
 * headroom (Mongo's per-document 16 MiB limit, vs ~16 KiB per
 * event upper-bound -> ~1024 events fits).
 */
const MAX_PERSISTED_LOG_EVENTS = 1000;

export interface CrawlStreamOptions {
  /**
   * Provider being crawled — emitted in the ``started`` event so
   * the UI can choose an icon and a project-shaped label.
   */
  provider: "github" | "gitlab";
  /** Canonical project identifier (``owner/repo`` or ``group/.../project``). */
  project: string;
  /** Hostname extracted from the API base URL — useful for self-hosted GitLab. */
  api_host: string;
  /**
   * The actual crawl work. Receives the emitter; should call
   * ``crawlGitHubRepo`` / ``crawlGitLabRepo`` (or anything that
   * accepts the emitter) and return the truncation result so
   * the helper can produce the final ``done`` event with the
   * same shape the row badge uses.
   */
  run: (emitter: CrawlEventEmitter) => Promise<{
    truncation: import("@/lib/hub-crawl").HubLastCrawlTruncation;
    skills: number;
  }>;
  /**
   * Optional callback invoked after the run completes, with the
   * persisted-shape log (array of CrawlEvent) capped at
   * ``MAX_PERSISTED_LOG_EVENTS``. Refresh path uses this to write
   * ``hub.last_crawl_log`` back to MongoDB. Preview leaves it
   * undefined so nothing is persisted.
   */
  persistLog?: (log: CrawlEvent[]) => Promise<void>;
}

/**
 * Convert an unknown error into a ``CrawlErrorCode`` and a message.
 * Mirrors the error taxonomy the UI distinguishes on; falls back
 * to ``internal`` for anything we can't pattern-match.
 */
function classifyError(err: unknown): { code: CrawlErrorCode; message: string; hint?: string } {
  const message = err instanceof Error ? err.message : String(err);
  // GitLab/GitHub formatGitLabFetchError already produces an
  // operator-actionable string for 401/403/404 — pass through.
  if (/401|403|404|insufficient_scope|read_repository|read_api/i.test(message)) {
    return { code: "auth_failed", message };
  }
  if (/timeout|aborted/i.test(message)) {
    return { code: "timeout", message };
  }
  if (/ENOTFOUND|ECONNREFUSED|fetch failed/i.test(message)) {
    return { code: "network", message };
  }
  if (/empty|namespaced path|invalid/i.test(message)) {
    return { code: "invalid_input", message };
  }
  return { code: "internal", message };
}

/**
 * Build a streaming ``Response`` whose body is the live NDJSON of
 * the crawl run. The stream emits, in order:
 *
 *   started → ...crawl helper events... → done | error
 *
 * Stream truncation (event count or byte budget) emits a synthetic
 * ``warning`` line right before the terminal ``done`` so the UI
 * can render "log truncated, crawl continued" rather than an
 * abrupt cutoff. The actual crawl is unaffected — caps gate the
 * wire only.
 */
export function buildCrawlStreamResponse(
  options: CrawlStreamOptions,
): Response {
  const { provider, project, api_host, run, persistLog } = options;
  const encoder = new NdjsonStreamEncoder();
  // We tee every encoded event into ``persistedLog`` so the refresh
  // path can durably store the run for later inspection. Capped to
  // avoid ballooning the hub document for large monorepos.
  const persistedLog: CrawlEvent[] = [];

  const utf8 = new TextEncoder();

  // Use a custom ReadableStream so we can write events as they
  // arrive. ``start`` runs synchronously when the stream is first
  // read; we kick off the actual crawl inside it and let the
  // controller keep the response open until we ``close`` it.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Wraps every emit: encode -> push to controller -> tee
      // into persistedLog (if not already capped). The encoder
      // is the single source of truth for whether an event was
      // dropped — never push ``dropped`` events to the wire.
      const writeEvent = (event: CrawlEvent) => {
        const r = encoder.encode(event);
        if (r.kind === "ok") {
          controller.enqueue(utf8.encode(r.line));
          if (persistedLog.length < MAX_PERSISTED_LOG_EVENTS) {
            // Sanitize is applied at encode-time. Persist the
            // SANITIZED form (parsed back from the line) so the
            // last-crawl log is also redacted if someone reads
            // it via a Mongo direct query, not just via the
            // streaming endpoint.
            try {
              persistedLog.push(JSON.parse(r.line));
            } catch {
              // Non-fatal: line was valid JSON when encoded so
              // this branch can only fire on a future encoder
              // bug. Skip rather than crash.
            }
          }
        }
      };

      const emitter: CrawlEventEmitter = {
        emit(event) {
          writeEvent(event);
        },
      };

      // Async IIFE so we can await the run while ``start`` itself
      // returns synchronously and the controller stays open.
      (async () => {
        const startedAt = Date.now();
        writeEvent({
          type: "started",
          provider,
          project,
          api_host,
          started_at: new Date(startedAt).toISOString(),
        });
        try {
          const result = await run(emitter);
          // Truncation warning surfaces in the live console BEFORE
          // ``done`` so consumers that only render the latest
          // event still see it. Crawl-helper-level truncation
          // (platform / cap) was already emitted as a warning
          // by the helper itself; this is the WIRE-level
          // truncation (encoder caps) we add here.
          if (encoder.truncated) {
            writeEvent({
              type: "warning",
              code: "fetch_failed",
              message:
                `Crawl log truncated: ${encoder.truncated} cap exceeded. ` +
                `The crawl continues; events past this point are not streamed.`,
            });
          }
          writeEvent({
            type: "done",
            skills: result.skills,
            requests: encoder.count,
            duration_ms: Date.now() - startedAt,
            truncation: result.truncation,
          });
        } catch (err) {
          const { code, message, hint } = classifyError(err);
          writeEvent({
            type: "error",
            code,
            message,
            ...(hint ? { hint } : {}),
          });
        } finally {
          if (persistLog) {
            try {
              await persistLog(persistedLog);
            } catch (persistErr) {
              // Persistence failure must not abort the response —
              // the stream is the primary deliverable and the log
              // is best-effort. Log to stderr so operators can
              // notice without it bubbling to the client.
              console.warn(
                "[CrawlStream] Failed to persist last_crawl_log:",
                persistErr,
              );
            }
          }
          controller.close();
        }
      })();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      // Disable upstream proxy buffering so the user sees events
      // as they happen, not in a single chunk after the response
      // body completes. ``X-Accel-Buffering: no`` is the nginx
      // convention; harmless on hosts that don't proxy through it.
      "X-Accel-Buffering": "no",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * Detect whether the caller wants the streaming branch. The
 * client (``crawl-stream-client.ts`` in commit 5) sends
 * ``Accept: application/x-ndjson``; legacy callers (curl probes,
 * tests, prior UI code) get the original JSON-shaped response.
 *
 * We deliberately do NOT make streaming the default — adding
 * Accept-content-negotiation as a safety net means any consumer
 * that doesn't opt in keeps working byte-for-byte unchanged.
 */
export function wantsNdjsonStream(request: Request): boolean {
  const accept = request.headers.get("accept") || "";
  return accept.toLowerCase().includes("application/x-ndjson");
}

/**
 * Best-effort host extraction from a base URL. Used for the
 * ``api_host`` field on the ``started`` event. Falls back to the
 * raw input if URL parsing fails — the field is informational, not
 * load-bearing.
 */
export function apiHostFromBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl;
  }
}

/** Helper: byte-length of an NDJSON-encoded log for persistence sizing. */
export function logByteSize(log: CrawlEvent[]): number {
  let total = 0;
  for (const e of log) {
    total += Buffer.byteLength(JSON.stringify(e), "utf8") + 1; // +1 newline
  }
  return total;
}

// Mark NOOP_EMITTER as exported-via to keep the dead-code import
// from being culled by tree-shaking; consumers who pass it
// directly do so via crawl-events.
export { NOOP_EMITTER };
