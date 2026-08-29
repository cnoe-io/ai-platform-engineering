/** Built-in CAIPE event subscribers. Add autonomous-agent triggers here. */

import {
  isRepositoryAttachedToTome,
  isTomeIssueCacheEvent,
  recordTomeIssueCacheEvent,
} from "@/lib/github-webhooks/tome-issue-cache";
import type { CaipeEvent, CaipeEventSubscriber } from "@/lib/events/types";

function githubEventType(event: CaipeEvent): string | null {
  return typeof event.data.github_event === "string"
    ? event.data.github_event
    : null;
}

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
];

export function findCaipeEventSubscriber(
  id: string,
): CaipeEventSubscriber | undefined {
  return caipeEventSubscribers.find((subscriber) => subscriber.id === id);
}
