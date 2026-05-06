/**
 * NDJSON wire encoder + secret redaction for the crawl-console
 * streaming feature. Takes a ``CrawlEvent`` (from
 * ``crawl-events.ts``) and produces one redacted JSON line + ``\n``
 * suitable for piping over an HTTP response body.
 *
 * Why a separate module from ``crawl-events.ts``
 * ----------------------------------------------
 *
 * The two concerns are deliberately decoupled:
 *
 *   - ``crawl-events.ts`` defines the SHAPE of events and an in-memory
 *     emitter used by the crawl helpers and unit tests. It has no
 *     opinion on transport or redaction.
 *
 *   - This file defines the WIRE FORMAT (NDJSON), the REDACTION
 *     pipeline (secrets in URLs, bodies, hint contexts), and the
 *     SAFETY CAPS (per-event size, total run size, total event
 *     count). Tests can substitute a buffering emitter without
 *     touching any of this.
 *
 * That split means the redaction surface is small enough to pin
 * down with focused unit tests, and a future migration to SSE or
 * WebSocket can swap this module out without touching the crawl
 * helpers or the UI store contract.
 *
 * Why NDJSON over SSE
 * -------------------
 *
 * 1. NDJSON survives JSON.parse() per line — no SSE framing parser
 *    needed on the client.
 *
 * 2. The Next.js streaming response uses
 *    ``Content-Type: application/x-ndjson`` which proxies and dev
 *    tools all handle correctly. SSE requires
 *    ``text/event-stream`` and a header-cooperative reverse proxy.
 *
 * 3. We can co-opt the same encoder to persist the last crawl log
 *    on the hub document by joining its lines into a single string
 *    field — SSE's ``data: ...\n\n`` framing would have to be
 *    stripped before persistence.
 *
 * 4. NDJSON has zero ambiguity around heartbeats and reconnects;
 *    we don't support resumption (a dropped stream means re-run),
 *    so SSE's ``id:`` field would be dead weight.
 */

import type { CrawlEvent } from "@/lib/crawl-events";

// ---------------------------------------------------------------------------
// Caps — sized so a worst-case adversarial monorepo cannot OOM the
// Node process or saturate the streaming HTTP response.
// ---------------------------------------------------------------------------

/**
 * Maximum number of events we will encode for a single crawl run.
 * Sized to comfortably cover the largest realistic monorepo
 * (skills-marketplace at ~3000 entries → ~3000 request events +
 * incidental skill_found / page / warning events). Crawls that
 * exceed this cap emit a final ``warning`` event with code
 * ``fetch_failed`` (semantic: "log truncated") and stop encoding;
 * the underlying crawl is unaffected and continues to completion.
 */
export const MAX_STREAM_EVENTS = 5000;

/**
 * Maximum byte budget for the entire encoded NDJSON stream of a
 * single run. Triggers the same truncation behavior as the event
 * count cap. Set deliberately above worst-case
 * (``MAX_STREAM_EVENTS * MAX_EVENT_BYTES``) so the byte cap is
 * effectively a runaway-content safeguard, not a normal-case limit.
 */
export const MAX_STREAM_BYTES = 8 * 1024 * 1024; // 8 MiB

/**
 * Maximum size of a single encoded event line (including the trailing
 * newline). Per-field redaction already clamps URLs and body previews;
 * this is a backstop against a future event type with an unbounded
 * field that someone forgot to clamp.
 */
export const MAX_EVENT_BYTES = 16 * 1024; // 16 KiB

/**
 * Maximum length of a URL after redaction. Long URLs still encode
 * to valid NDJSON, but they degrade UI rendering (and bloat the
 * persisted log on hub docs). Truncated URLs get a ``…[truncated]``
 * suffix so the operator can tell the value isn't representative.
 */
export const MAX_URL_CHARS = 512;

/**
 * Maximum length of a body preview after secret redaction. The
 * crawler captures up to 1KB of body text for 4xx/5xx responses;
 * after redaction strips ``Authorization`` headers, JWT/PAT shapes,
 * and obvious token patterns, we cap at this length so a server
 * that mirrors the request body back can't blow the event budget.
 */
export const MAX_BODY_PREVIEW_CHARS = 512;

// ---------------------------------------------------------------------------
// Secret patterns — redacted from URLs (query strings) and from
// 4xx/5xx body previews. The list errs on the side of being noisy
// rather than missing a leak: if a string looks even slightly like
// a token, replace it with `***`. Operator-grade UX is acceptable
// collateral — the dialog is admin-only and a mis-redacted hostname
// is recoverable; a leaked PAT is not.
// ---------------------------------------------------------------------------

/**
 * Pre-built redaction passes. Each entry is applied IN ORDER to
 * a string and the result is fed to the next pass. Order matters:
 * URL-shaped credentials are stripped before generic
 * "long base64 token" matches kick in, otherwise a query-string
 * value would be partially redacted to a still-recognizable URL.
 */
const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp; replacement: string }> = [
  // ---- 1. Authorization-shaped query parameters ----
  // Matches ``private_token=…``, ``access_token=…``,
  // ``personal_access_token=…``, ``token=…``, ``api_key=…``,
  // ``apikey=…`` plus ``authentication=…`` / ``auth=…``. Captures
  // the parameter name so we can preserve it in the replacement
  // and only mask the value (so the operator can still see WHICH
  // secret leaked, not just that one did).
  {
    name: "url_token_param",
    re: /([?&](?:private[_-]?token|access[_-]?token|personal[_-]?access[_-]?token|token|api[_-]?key|apikey|auth(?:entication)?)=)[^&#\s]+/gi,
    replacement: "$1***",
  },

  // ---- 2. URL userinfo (``https://user:pass@host``) ----
  // Any ``://something:something@`` pattern is almost always a
  // credential. Mask the password component; keep the username so
  // operators can still attribute the request.
  {
    name: "url_userinfo",
    re: /(:\/\/[^/\s:@]+):([^@\s/]+)@/g,
    replacement: "$1:***@",
  },

  // ---- 3. JWT (header.payload.signature, base64url with dots) ----
  // ``eyJ`` is the base64-encoded leading byte of a JSON object —
  // every JWT we've ever seen starts with it. Keep the leading
  // ``eyJ`` so the operator can tell what was redacted.
  {
    name: "jwt",
    re: /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    replacement: "eyJ***[redacted-jwt]",
  },

  // ---- 4. GitHub fine-grained / classic tokens ----
  // GitHub's prefixes are stable: ghp_/gho_/ghu_/ghs_/ghr_ for
  // classic + new-style PATs, github_pat_ for fine-grained.
  {
    name: "github_pat",
    re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
    replacement: "***[redacted-github-token]",
  },
  {
    name: "github_pat_fine_grained",
    re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    replacement: "***[redacted-github-token]",
  },

  // ---- 5. GitLab tokens (glpat-) ----
  {
    name: "gitlab_pat",
    re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g,
    replacement: "***[redacted-gitlab-token]",
  },

  // ---- 6. AWS access keys ----
  // 16/20-char prefixes per the AWS pattern. Stick to the
  // canonical 20-char form — false positives on shorter prefixes
  // outweigh the risk of missing a non-standard key.
  {
    name: "aws_access_key",
    re: /\b(?:AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[0-9A-Z]{16}\b/g,
    replacement: "***[redacted-aws-key]",
  },

  // ---- 7. Stripe-style live/test keys ----
  {
    name: "stripe_key",
    re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
    replacement: "***[redacted-stripe-key]",
  },

  // ---- 8. Authorization HTTP headers leaking through body
  //         preview (e.g. echoed in a 4xx error response). Match
  //         "Authorization: Bearer ..." and "PRIVATE-TOKEN: ..."
  //         on a line and mask EVERYTHING after the colon up to
  //         the line ending. We must not stop at the first
  //         whitespace because the canonical header value
  //         ("Authorization: Bearer <secret>") has a space inside
  //         it; an early-terminating match would leak the secret.
  {
    name: "auth_header_in_body",
    re: /^([ \t]*(?:Authorization|PRIVATE-TOKEN|X-Auth-Token))\s*:\s*[^\r\n]+/gim,
    replacement: "$1: ***",
  },
];

/**
 * Apply every redaction pass to a string. Idempotent — running
 * twice is safe (and exercised by the test suite to pin the
 * contract). Returns the input unchanged if none of the patterns
 * fire, with no allocation in the happy path.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  for (const pass of SECRET_PATTERNS) {
    out = out.replace(pass.re, pass.replacement);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Per-field redaction
// ---------------------------------------------------------------------------

/**
 * Redact + clamp a URL for display. We pass the URL through the
 * full secret pattern list (catches query-string tokens and
 * userinfo) and then truncate to ``MAX_URL_CHARS`` so an
 * adversarially long URL can't blow the event budget. The
 * truncation marker is part of the truncated string, not a sibling
 * field, so naive consumers display "something visibly cut off"
 * even if they don't know about the cap.
 */
function redactUrl(url: string): string {
  const clean = redactSecrets(url);
  if (clean.length <= MAX_URL_CHARS) return clean;
  return clean.slice(0, MAX_URL_CHARS - 16) + "…[truncated]";
}

/**
 * Redact + clamp a 4xx/5xx body preview. The crawler already
 * caps at 1KB; this layer adds secret redaction (errors that echo
 * the auth header are common) and a final character cap.
 */
function redactBodyPreview(body: string): string {
  const clean = redactSecrets(body);
  if (clean.length <= MAX_BODY_PREVIEW_CHARS) return clean;
  return clean.slice(0, MAX_BODY_PREVIEW_CHARS - 16) + "…[truncated]";
}

/**
 * Redact a context object's string values. Numeric / boolean
 * values pass through. Non-primitive values are coerced via
 * ``String(...)`` and then redacted, but the event taxonomy
 * already constrains contexts to primitives, so this is a
 * belt-and-braces guard for a future event addition that
 * accidentally embeds a token.
 */
function redactContext(
  ctx: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> | undefined {
  if (!ctx) return ctx;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(ctx)) {
    if (typeof value === "string") {
      out[key] = redactSecrets(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Apply per-field redaction + clamping to a ``CrawlEvent`` and
 * return a new event safe to serialize to the wire. Pure function;
 * the input event is not mutated. Unknown ``type`` values are
 * passed through unchanged so a future event addition isn't
 * silently dropped — but the worst-case wire field
 * (``MAX_EVENT_BYTES``) still backstops at the encoder layer.
 */
export function sanitizeEvent(event: CrawlEvent): CrawlEvent {
  switch (event.type) {
    case "request":
      return {
        ...event,
        url: redactUrl(event.url),
        body_preview: event.body_preview
          ? redactBodyPreview(event.body_preview)
          : event.body_preview,
      };
    case "warning":
    case "error":
      return {
        ...event,
        message: redactSecrets(event.message),
        // Errors carry an optional ``hint`` separate from
        // ``message``; redact both so a hint that references the
        // configured token (e.g. "your token glpat-... is missing
        // read_api scope") doesn't leak.
        ...(("hint" in event && event.hint)
          ? { hint: redactSecrets(event.hint) }
          : {}),
        context: redactContext(event.context),
      };
    case "started":
      // ``api_host`` is host-only and ``project`` is namespaced —
      // neither contains secrets in normal use. Redact ``project``
      // anyway as a guard against pasting a tokenized URL.
      return {
        ...event,
        project: redactSecrets(event.project),
      };
    default:
      // page / skill_found / done — fields are numeric, enum, or
      // pre-sanitized at the source. Pass through.
      return event;
  }
}

// ---------------------------------------------------------------------------
// NDJSON encoder
// ---------------------------------------------------------------------------

/**
 * Result of encoding a single event. Exported for the tests that
 * pin truncation behavior and for the streaming route which needs
 * to know whether an event was dropped (so it can stop pulling
 * from the buffer / emit a final truncation warning).
 */
export type EncodeResult =
  | { kind: "ok"; line: string; bytes: number }
  | { kind: "dropped"; reason: "event_count" | "byte_budget" | "event_too_large" };

/**
 * Stateful NDJSON encoder. Pass each event through ``encode``; when
 * any cap trips, the encoder stops emitting and subsequent
 * ``encode`` calls return ``{ kind: "dropped" }`` without further
 * work. Callers MAY emit a synthetic terminal warning before
 * closing the stream so the operator sees "log truncated" instead
 * of an abrupt cutoff.
 *
 * Not thread-safe (Node single-threaded; this isn't a concern in
 * practice). Construct one encoder per crawl run.
 */
/** Truncation reason; only the ``dropped`` variant of EncodeResult carries one. */
export type TruncationReason = Extract<EncodeResult, { kind: "dropped" }>["reason"];

export class NdjsonStreamEncoder {
  private events_emitted = 0;
  private bytes_emitted = 0;
  private truncated_reason: TruncationReason | null = null;

  encode(event: CrawlEvent): EncodeResult {
    if (this.truncated_reason !== null) {
      return { kind: "dropped", reason: this.truncated_reason };
    }
    if (this.events_emitted >= MAX_STREAM_EVENTS) {
      this.truncated_reason = "event_count";
      return { kind: "dropped", reason: "event_count" };
    }

    const sanitized = sanitizeEvent(event);
    const line = JSON.stringify(sanitized) + "\n";
    const bytes = Buffer.byteLength(line, "utf8");

    if (bytes > MAX_EVENT_BYTES) {
      // A single event exceeded the per-event cap. We don't try
      // to truncate the JSON in place (would produce invalid
      // syntax); instead drop this one event and keep going so
      // the rest of the stream stays useful. The caller's run
      // continues normally.
      return { kind: "dropped", reason: "event_too_large" };
    }
    if (this.bytes_emitted + bytes > MAX_STREAM_BYTES) {
      this.truncated_reason = "byte_budget";
      return { kind: "dropped", reason: "byte_budget" };
    }

    this.events_emitted += 1;
    this.bytes_emitted += bytes;
    return { kind: "ok", line, bytes };
  }

  /** Encoded event count (for the final ``done`` event's ``requests`` field if needed). */
  get count(): number {
    return this.events_emitted;
  }

  /** Reason the stream was truncated, or null if it ran to completion. */
  get truncated(): TruncationReason | null {
    return this.truncated_reason;
  }
}
