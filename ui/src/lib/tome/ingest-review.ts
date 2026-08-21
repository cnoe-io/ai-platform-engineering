/**
 * Decide whether a completed ingest must stop at the human-review gate.
 * An explicit per-run bypass wins; otherwise only runs that actually wrote
 * at least one draft have anything to review.
 */
export function shouldAwaitIngestReview(args: {
  skipReview: boolean;
  draftPaths: string[];
}): boolean {
  return !args.skipReview && args.draftPaths.length > 0;
}
