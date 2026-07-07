// Source-activity feed: normalized events fetched from a project's
// connected sources (GitHub in v1), emitted into the project's Mycelium room as
// `event` messages (kind `source_event`) for the Feed view.

/** The kind of asset an event concerns. Drives the feed's icon + "view"
 * affordance — the presentation keys off this typed discriminator, never off
 * parsing the `event` string. */
export type SourceArtifact = "pr" | "issue" | "release" | "commit";

/** A single curated activity event from a source. */
export interface SourceEvent {
  source: "github";
  /** The asset this event is about (PR / issue / release / …). */
  artifact: SourceArtifact;
  /** Specific action, e.g. pr_opened / pr_merged / issue_closed. Retained for
   * filtering + analytics; presentation must key off `artifact`, not this. */
  event: string;
  /** Human-readable one-line label rendered in the feed. */
  title: string;
  /** Canonical URL to the underlying artifact. */
  url: string;
  /** Stable ref, e.g. `org/repo#48` or `org/repo@v1.2.0`. */
  ref: string;
  /** Actor login, when known. */
  actor: string | null;
  /** ISO timestamp of the event (the state change that produced it). */
  ts: string;
  /** `owner/name`. */
  repo: string;
}

/** Provenance ref shape accepted by the Mycelium `event` primitive (#392). */
export interface EventProvenance {
  type: "pr" | "commit" | "issue" | "page" | "message";
  ref: string;
  url?: string;
}
