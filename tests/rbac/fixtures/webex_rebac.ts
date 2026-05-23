export interface WebexSpaceResourceGrantFixture {
  readonly workspaceId: string;
  readonly spaceId: string;
  readonly spaceName: string;
  readonly teamSlug: string;
  readonly resources: readonly {
    readonly type: "agent" | "tool" | "knowledge_base";
    readonly id: string;
    readonly actions: readonly ("use" | "read" | "invoke" | "call" | "ingest")[];
  }[];
}

export const WEBEX_REBAC_FIXTURES: readonly WebexSpaceResourceGrantFixture[] = [
  {
    workspaceId: "CAIPE",
    spaceId: "Y2lzY29zcGFyazovL3VzL1JPT00vcGxhdGZvcm0tb3Bz",
    spaceName: "platform-ops",
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
    workspaceId: "CAIPE",
    spaceId: "Y2lzY29zcGFyazovL3VzL1JPT00va2ItaW5nZXN0",
    spaceName: "kb-ingest",
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
