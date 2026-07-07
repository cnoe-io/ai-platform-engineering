/**
 * Epic linkage extractor.
 *
 * Sub-tasks, PRs, deploys, and reviews need their parent Epic id so the
 * projector can emit on the right per-Epic SSE channel. We support two
 * signals, in priority order:
 *
 *   1) An `epic:<artifactId>` label (preferred) -- explicit, unambiguous,
 *      and cheap for agents to apply via the labels API.
 *   2) A trailing `Parent-Epic: <artifactId>` line in the body
 *      (fallback) -- works when an agent only controls the body.
 *
 * Convention frozen here so the mock-webhook flow script can rely on it
 * and so the spec contract has a single answer to "how does an artifact
 * know which Epic it belongs to?". Pure: no I/O, no env, no network.
 */

const EPIC_LABEL_PREFIX = "epic:";
const PARENT_EPIC_BODY_RE = /Parent-Epic:\s*([A-Za-z0-9_=\-/]+)/m;

export function extractEpicId(
  labels: readonly string[] | undefined | null,
  body: string | null | undefined,
): string | null {
  if (labels) {
    for (const label of labels) {
      if (typeof label !== "string") continue;
      const lower = label.toLowerCase();
      if (lower.startsWith(EPIC_LABEL_PREFIX)) {
        const suffix = label.slice(EPIC_LABEL_PREFIX.length).trim();
        if (suffix) return suffix;
      }
    }
  }
  if (body) {
    const m = PARENT_EPIC_BODY_RE.exec(body);
    if (m && m[1]) return m[1];
  }
  return null;
}
