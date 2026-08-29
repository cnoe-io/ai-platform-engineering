/** GitHub event contracts shared by webhook installation and ingress. */

export const TOME_GITHUB_WEBHOOK_EVENTS = [
  "issues",
  "issue_comment",
  "discussion",
  "discussion_comment",
  "label",
  "milestone",
] as const;

export const ACCEPTED_GITHUB_WEBHOOK_EVENTS = new Set<string>([
  ...TOME_GITHUB_WEBHOOK_EVENTS,
  "ping",
]);

export type TomeGitHubWebhookEvent =
  (typeof TOME_GITHUB_WEBHOOK_EVENTS)[number];
