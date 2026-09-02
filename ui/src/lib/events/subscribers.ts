/** Built-in CAIPE event subscribers. Add autonomous-agent triggers here. */

import {
  isRepositoryAttachedToTome,
  isTomeIssueCacheEvent,
  recordTomeIssueCacheEvent,
} from "@/lib/github-webhooks/tome-issue-cache";
import { emitLabelChangeToFeed } from "@/lib/tome/source-feed/webhook";
import type { CaipeEvent, CaipeEventSubscriber } from "@/lib/events/types";

function githubEventType(event: CaipeEvent): string | null {
  return typeof event.data.github_event === "string"
    ? event.data.github_event
    : null;
}

function githubAction(event: CaipeEvent): string | null {
  return typeof event.data.action === "string" ? event.data.action : null;
}

interface LabelableSnapshot {
  number: number;
  title: string;
  url: string;
  labels: string[];
}

function isLabelableSnapshot(value: unknown): value is LabelableSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LabelableSnapshot>;
  return (
    typeof candidate.number === "number" &&
    typeof candidate.title === "string" &&
    typeof candidate.url === "string" &&
    Array.isArray(candidate.labels)
  );
}

const LABEL_CHANGE_ACTIONS = new Set(["labeled", "unlabeled"]);

/** Bridges real-time `labeled`/`unlabeled` webhook deliveries straight into
 * the project Feed — see `@/lib/tome/source-feed/webhook.ts` for why the
 * (poller-only) source-activity feed can't catch these on its own. */
const tomeFeedLabelChangeSubscriber: CaipeEventSubscriber = {
  id: "tome.feed.label-change.v1",
  matches(event) {
    const eventType = githubEventType(event);
    const action = githubAction(event);
    return (
      event.source === "github" &&
      (eventType === "issues" || eventType === "pull_request") &&
      Boolean(action && LABEL_CHANGE_ACTIONS.has(action))
    );
  },
  async handle(event) {
    const eventType = githubEventType(event);
    const action = githubAction(event);
    const repoId = event.data.repository_id;
    const fullName = event.data.repository_full_name;
    if (
      !eventType ||
      !action ||
      typeof repoId !== "number" ||
      typeof fullName !== "string"
    ) {
      throw new Error("GitHub event is missing normalized repository metadata");
    }
    const snapshot =
      eventType === "pull_request" ? event.data.pull_request : event.data.issue;
    if (!isLabelableSnapshot(snapshot)) return; // malformed/incomplete payload
    const labelName =
      typeof event.data.label_name === "string" ? event.data.label_name : null;
    const actor =
      typeof event.data.sender_login === "string" ? event.data.sender_login : null;
    await emitLabelChangeToFeed({
      repoId,
      repoFullName: fullName,
      action: action as "labeled" | "unlabeled",
      artifact: eventType === "pull_request" ? "pr" : "issue",
      number: snapshot.number,
      title: snapshot.title,
      url: snapshot.url,
      labels: snapshot.labels,
      labelName,
      actor,
      ts: new Date(event.time).toISOString(),
    });
  },
};

const tomeGitHubIssueCacheSubscriber: CaipeEventSubscriber = {
  id: "tome.github-issue-cache.v1",
  matches(event) {
    const eventType = githubEventType(event);
    return event.source === "github" && Boolean(eventType && isTomeIssueCacheEvent(eventType));
  },
  async handle(event) {
    const eventType = githubEventType(event);
    const repoId = event.data.repository_id;
    const fullName = event.data.repository_full_name;
    const deliveryId = event.data.delivery_id;
    if (
      !eventType ||
      typeof repoId !== "number" ||
      typeof fullName !== "string"
    ) {
      throw new Error("GitHub event is missing normalized repository metadata");
    }
    if (!(await isRepositoryAttachedToTome(repoId, fullName))) return;
    await recordTomeIssueCacheEvent({
      repoId,
      fullName,
      eventType,
      deliveryId: typeof deliveryId === "string" ? deliveryId : null,
      issue: event.data.issue,
      discussion: event.data.discussion,
    });
  },
};

export const caipeEventSubscribers: readonly CaipeEventSubscriber[] = [
  tomeGitHubIssueCacheSubscriber,
  tomeFeedLabelChangeSubscriber,
];

export function findCaipeEventSubscriber(
  id: string,
): CaipeEventSubscriber | undefined {
  return caipeEventSubscribers.find((subscriber) => subscriber.id === id);
}
