/**
 * Crawl event taxonomy for the live "Crawl Console" admin feature.
 *
 * The hub crawlers (`crawlGitHubRepo`, `crawlGitLabRepo`) accept an
 * optional ``CrawlEventEmitter`` that lets callers observe each
 * outbound HTTP request and each SKILL.md discovered while the
 * crawl is in flight. The two streaming routes
 * (``POST /api/skill-hubs/crawl`` and
 * ``POST /api/skill-hubs/[id]/refresh``) wrap an emitter around an
 * NDJSON `ReadableStream` so the admin UI can render a live console.
 *
 * # Why a separate module
 *
 * The events are deliberately decoupled from the wire format. This
 * file defines the *shape* of events and a no-op base emitter. The
 * NDJSON encoder, redaction utilities, and size caps live in
 * ``crawl-stream.ts`` (see commit #2 of the streaming feature).
 * Tests can substitute a buffering emitter (``BufferingCrawlEmitter``
 * below) without touching any HTTP plumbing.
 *
 * # Backward compatibility
 *
 * The ``emitter`` parameter is optional everywhere. When omitted,
 * the crawl helpers behave exactly as before — no extra allocations,
 * no extra requests, no behavior change. This file is the foundation
 * commit of the streaming feature; subsequent commits add the wire
 * encoder, the API streaming branch, and the UI.
 */

// ---------------------------------------------------------------------------
// Event taxonomy
// ---------------------------------------------------------------------------

/**
 * Phase of the crawl an HTTP request belongs to. Lets the UI render
 * filter chips ("show only SKILL.md fetches") without inferring the
 * phase from URL pattern matching, which is brittle across providers.
 */
export type CrawlRequestPhase =
  | "tree" // listing the repo's git tree (GitHub trees API / GitLab repository/tree)
  | "skill_md" // fetching a SKILL.md body
  | "ancillary" // fetching a non-SKILL.md sibling file (scripts, references, etc.)
  | "introspect"; // post-failure: probing token scopes (GitLab /personal_access_tokens/self)

/**
 * Severity of a non-fatal warning during a crawl. Errors that
 * abort the crawl use the ``error`` event and a different shape.
 */
export type CrawlWarningCode =
  | "tree_truncated_platform" // GitHub's 100k-entry / 7MB trees-API cap was hit
  | "tree_truncated_pages" // GitLab pagination capped at GITLAB_MAX_TREE_PAGES
  | "skill_skipped_size" // ancillary file exceeded HUB_ANCILLARY_PER_FILE_BYTES
  | "skill_skipped_binary" // ancillary file looked binary (heuristic)
  | "skill_skipped_count" // hit per-skill ancillary file count cap
  | "scope_mismatch" // token works but lacks scope for this endpoint
  | "rate_limited" // 429 from provider
  | "fetch_failed"; // single-file fetch failed but crawl continues

export type CrawlErrorCode =
  | "auth_failed" // 401/403/404 cluster — provider refused to confirm project
  | "not_found" // genuine 404 (post-introspection, when we can tell)
  | "timeout" // Node fetch timeout (AbortSignal)
  | "network" // connect timeout / DNS / TLS / etc.
  | "invalid_input" // malformed project path, missing token, etc.
  | "internal"; // unexpected exception inside the crawler

/**
 * Per-request log entry. Headers are NOT included here — this lives
 * on the ``CrawlEvent`` type and is what gets serialized to the
 * client. The wire encoder (next commit) layers redaction over the
 * top to make sure no Authorization / PRIVATE-TOKEN value can ever
 * leak even by accident.
 *
 * The URL is captured as observed; the encoder MAY truncate or
 * percent-decode segments for display, but never alters the value
 * passed to the emitter.
 */
export interface CrawlRequestEvent {
  type: "request";
  /** HTTP method (always uppercase). */
  method: string;
  /** Full URL as sent. The encoder redacts query-string secrets if any. */
  url: string;
  /** HTTP status, or 0 for transport failures (`fetch failed`). */
  status: number;
  /** Wall-clock duration in milliseconds, integer-rounded. */
  duration_ms: number;
  /** ``Content-Length`` header if present, otherwise undefined. */
  bytes?: number;
  /** Crawl phase — see {@link CrawlRequestPhase}. */
  phase: CrawlRequestPhase;
  /**
   * For 4xx/5xx responses, a body excerpt up to 1KB. Secret-pattern
   * redaction is applied by the wire encoder, not here. ``undefined``
   * for 2xx (we don't capture happy-path bodies, both for memory and
   * to avoid leaking source code into logs).
   */
  body_preview?: string;
}

export interface CrawlStartedEvent {
  type: "started";
  provider: "github" | "gitlab";
  /** Canonical project identifier (`owner/repo` or `group/.../project`). */
  project: string;
  /** Hostname of the API base URL — useful when self-hosted is in play. */
  api_host: string;
  /** ISO-8601 timestamp at which the crawl began. */
  started_at: string;
}

export interface CrawlPageEvent {
  type: "page";
  /** 1-indexed page number we just walked. */
  page: number;
  /** Number of entries returned by this page (after filtering, if any). */
  entries: number;
  /** Whether a ``next`` page is available (GitLab `x-next-page` header). */
  has_next: boolean;
}

export interface CrawlSkillFoundEvent {
  type: "skill_found";
  /** Repo-relative path of the SKILL.md (e.g. `plugins/jira/skills/foo/SKILL.md`). */
  path: string;
  /** Skill display name (frontmatter `name` if present, else folder basename). */
  name: string;
  /** Number of ancillary sibling files captured for this skill. */
  ancillary_count: number;
}

export interface CrawlWarningEvent {
  type: "warning";
  code: CrawlWarningCode;
  message: string;
  /**
   * Optional structured context — e.g. the path that was skipped,
   * the page number we capped at, the scope the token is missing.
   * Stringified to the wire as-is; keep it small.
   */
  context?: Record<string, string | number | boolean>;
}

export interface CrawlErrorEvent {
  type: "error";
  code: CrawlErrorCode;
  message: string;
  /**
   * Operator-actionable hint, distinct from ``message`` so the UI
   * can render "what happened" and "what to do" as separate lines.
   */
  hint?: string;
  /** Same shape as warning context — e.g. status code, scope list. */
  context?: Record<string, string | number | boolean>;
}

export interface CrawlDoneEvent {
  type: "done";
  /** Number of SKILL.md files successfully ingested. */
  skills: number;
  /** Total HTTP requests made during the crawl (all phases). */
  requests: number;
  /** Total wall-clock duration in milliseconds, integer-rounded. */
  duration_ms: number;
  /**
   * Truncation result mirrored from ``CrawlResult.truncation`` so
   * the dialog can show the same warning the row badge does, in
   * line, without an extra round trip. Schema matches
   * ``HubLastCrawlTruncation`` in ``hub-crawl.ts`` byte-for-byte —
   * keep them aligned (drift here means the UI dialog and the row
   * badge can disagree about whether a crawl was truncated).
   */
  truncation:
    | { kind: "ok"; pages_walked: number }
    | { kind: "platform"; pages_walked: number; reason: string }
    | { kind: "cap"; pages_walked: number; cap: number };
}

/**
 * Discriminated union of all events that may appear on a crawl
 * stream. The order is fixed: exactly one ``started`` event, then
 * any number of ``request`` / ``page`` / ``skill_found`` / ``warning``
 * events in chronological order, then exactly one terminal event
 * (``done`` on success, ``error`` on a fatal failure — never both).
 *
 * Consumers MUST treat any unknown ``type`` as a forwards-compatible
 * extension and ignore it without erroring. New event types should
 * only be added in a way that lets old consumers keep working.
 */
export type CrawlEvent =
  | CrawlStartedEvent
  | CrawlRequestEvent
  | CrawlPageEvent
  | CrawlSkillFoundEvent
  | CrawlWarningEvent
  | CrawlErrorEvent
  | CrawlDoneEvent;

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

/**
 * Sink for crawl events. The crawl helpers call ``emit`` zero or
 * more times during a crawl and never throw from within an emit
 * call — implementations MUST swallow their own errors so a broken
 * sink can't abort an otherwise-healthy crawl. (The wire encoder
 * surfaces sink failures via a separate ``error`` callback, not by
 * propagating to the crawler.)
 *
 * The ``NoopCrawlEmitter`` below is the default when callers don't
 * need observation — it eliminates a whole class of "did we
 * accidentally allocate a buffer in production" worries by being a
 * statically-allocated singleton.
 */
export interface CrawlEventEmitter {
  emit(event: CrawlEvent): void;
}

/**
 * The do-nothing emitter. Used as the default in the crawl helpers
 * so the streaming feature is purely opt-in. Exporting a singleton
 * (rather than constructing a new one per call) means the no-emitter
 * code path has zero allocations in the hot loop.
 */
export const NOOP_EMITTER: CrawlEventEmitter = Object.freeze({
  emit(_: CrawlEvent): void {
    // Intentionally empty — see class docstring.
  },
});

/**
 * In-memory emitter used by tests. Holds the full event history
 * so assertions can inspect the sequence the crawler produced
 * without touching wire format or HTTP plumbing.
 *
 * Not exported as a default from the streaming feature — production
 * callers always go through the NDJSON wire encoder. Tests can
 * import this directly.
 */
export class BufferingCrawlEmitter implements CrawlEventEmitter {
  readonly events: CrawlEvent[] = [];

  emit(event: CrawlEvent): void {
    this.events.push(event);
  }

  /** Convenience: filter by type (preserves order). */
  byType<T extends CrawlEvent["type"]>(
    type: T,
  ): Extract<CrawlEvent, { type: T }>[] {
    return this.events.filter(
      (e): e is Extract<CrawlEvent, { type: T }> => e.type === type,
    );
  }
}
