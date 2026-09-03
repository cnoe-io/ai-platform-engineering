/** Fixed author/sender identities used for content written or posted by
 * Tome itself, rather than a real user. Centralized so freshness checks
 * (e.g. "was this revision a human edit?") stay in sync with what writers
 * actually pass, instead of comparing against magic strings independently. */
export const AGENT_IDENTITIES = {
  /** Generic Tome identity: default author when no user is attributable,
   * and the feed sender handle for system-posted events. */
  default: "tome",
  /** Author tag for page revisions written by the ingest pipeline. */
  ingestor: "tome-ingest",
} as const;

export type AgentIdentity = (typeof AGENT_IDENTITIES)[keyof typeof AGENT_IDENTITIES];

/** All identities that represent Tome itself rather than a human — used to
 * filter revisions down to ones a person actually made. */
export const SYSTEM_AGENT_IDENTITIES: AgentIdentity[] = Object.values(AGENT_IDENTITIES);
