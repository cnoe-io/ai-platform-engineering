// GitHub webhook → Feed bridge for label changes on issues and PRs.
//
// The source-activity poller (`poller.ts`) only diffs the open/closed/merged
// timestamps on each PR/issue, so it never notices a label being added or
// removed — including the label-derived "in progress" status (see
// `displayStatusFromIssue`). A `labeled`/`unlabeled` webhook delivery already
// carries exactly which label changed, in real time, so this posts a
// `source_event` straight to the Feed instead of waiting for the next poll.

import {
  IN_PROGRESS_LABEL_ALIASES,
} from "@/lib/github-issue-snapshot";
import { projectSlugsForRepository } from "@/lib/github-webhooks/tome-issue-cache";
import { isMyceliumConfigured, postEvent } from "@/lib/tome/mycelium";

import { provenanceFor } from "./github";
import type { SourceArtifact, SourceEvent } from "./types";

export interface WebhookLabelChange {
  repoId: number;
  repoFullName: string;
  action: "labeled" | "unlabeled";
  artifact: Extract<SourceArtifact, "issue" | "pr">;
  number: number;
  title: string;
  url: string;
  /** Current label list on the issue/PR, after this change. */
  labels: string[];
  labelName: string | null;
  actor: string | null;
  ts: string;
}

function isStatusLabel(label: string | null): boolean {
  if (!label) return false;
  const normalized = label.trim().toLowerCase();
  return (IN_PROGRESS_LABEL_ALIASES as readonly string[]).includes(normalized);
}

function titleFor(change: WebhookLabelChange): string {
  const kind = change.artifact === "pr" ? "PR" : "Issue";
  const ref = `#${change.number}`;
  if (isStatusLabel(change.labelName)) {
    const status = change.action === "labeled" ? "In Progress" : "Open";
    return `${kind} moved to ${status}: "${change.title}" (${ref})`;
  }
  const verb = change.action === "labeled" ? "added" : "removed";
  const label = change.labelName ? `\`${change.labelName}\`` : "a label";
  return `${kind} label ${verb}: ${label} on "${change.title}" (${ref})`;
}

/** Post a Feed entry for a webhook-sourced label add/remove. No-ops when
 * Mycelium isn't configured or the repo isn't attached to any project. */
export async function emitLabelChangeToFeed(
  change: WebhookLabelChange,
): Promise<void> {
  if (!isMyceliumConfigured()) return;
  const slugs = await projectSlugsForRepository(change.repoId, change.repoFullName);
  if (slugs.length === 0) return;

  const event: SourceEvent = {
    source: "github",
    artifact: change.artifact,
    event: change.action === "labeled" ? "label_added" : "label_removed",
    title: titleFor(change),
    url: change.url,
    ref: `${change.repoFullName}#${change.number}`,
    actor: change.actor,
    ts: change.ts,
    repo: change.repoFullName,
    labels: change.labels,
  };

  await Promise.all(
    slugs.map((slug) =>
      postEvent(slug, {
        sender_handle: "github",
        content: event.title,
        kind: "source_event",
        payload: {
          source: event.source,
          artifact: event.artifact,
          event: event.event,
          repo: event.repo,
          ref: event.ref,
          url: event.url,
          actor: event.actor,
          ts: event.ts,
          labels: event.labels,
        },
        provenance: provenanceFor(event),
      }),
    ),
  );
}
