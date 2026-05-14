export interface SlackChannelResourceGrantFixture {
  readonly workspaceId: string;
  readonly channelId: string;
  readonly channelName: string;
  readonly teamSlug: string;
  readonly resources: readonly {
    readonly type: "agent" | "tool" | "knowledge_base";
    readonly id: string;
    readonly actions: readonly ("use" | "read" | "invoke" | "call" | "ingest")[];
  }[];
}

export const SLACK_REBAC_FIXTURES: readonly SlackChannelResourceGrantFixture[] = [
  {
    workspaceId: "TCAIPEDEMO",
    channelId: "CPLATFORMOPS",
    channelName: "platform-ops",
    teamSlug: "platform",
    resources: [
      {
        type: "agent",
        id: "platform-engineer",
        actions: ["use"],
      },
      {
        type: "tool",
        id: "argocd",
        actions: ["call"],
      },
      {
        type: "knowledge_base",
        id: "platform-runbooks",
        actions: ["read"],
      },
    ],
  },
  {
    workspaceId: "TCAIPEDEMO",
    channelId: "CKBINGEST",
    channelName: "kb-ingest",
    teamSlug: "knowledge-base-ingestors",
    resources: [
      {
        type: "knowledge_base",
        id: "platform-runbooks",
        actions: ["read", "ingest"],
      },
    ],
  },
];
