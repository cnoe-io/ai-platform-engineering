import { readFileSync } from "node:fs";
import path from "node:path";

import { webexSpaceSubjectId } from "@/lib/rbac/webex-space-grant-store";

import {
  buildOpenFgaTuple,
  buildOpenFgaTupleDiff,
  openFgaObject,
  openFgaRelation,
  openFgaSubject,
} from "../../tuple-builders";

const AUTHORIZATION_MODEL_PATHS = [
  path.join(process.cwd(), "../charts/ai-platform-engineering/charts/openfga/authorization-model.json"),
];

type AuthorizationModel = {
  type_definitions?: Array<{
    type?: string;
    metadata?: {
      relations?: Record<
        string,
        { directly_related_user_types?: Array<{ type?: string }> }
      >;
    };
  }>;
};

function loadAuthorizationModel(modelPath: string): AuthorizationModel {
  return JSON.parse(readFileSync(modelPath, "utf8")) as AuthorizationModel;
}

function directSubjectTypes(
  model: AuthorizationModel,
  resourceType: string,
  relation: string
): string[] {
  const definition = model.type_definitions?.find((entry) => entry.type === resourceType);
  const relationMeta = definition?.metadata?.relations?.[relation];
  return (relationMeta?.directly_related_user_types ?? [])
    .map((subject) => subject.type)
    .filter((type): type is string => Boolean(type));
}

function expectMessagingSubjectParity(
  modelPath: string,
  resourceType: string,
  relation: string,
  webexSubjectType: "webex_bot_installation" | "webex_space"
): void {
  const subjects = directSubjectTypes(loadAuthorizationModel(modelPath), resourceType, relation);
  expect(subjects).toContain("slack_channel");
  expect(subjects).toContain(webexSubjectType);
  const slackIndex = subjects.indexOf("slack_channel");
  const webexIndex = subjects.indexOf(webexSubjectType);
  expect(webexIndex).toBe(slackIndex + 1);
}

describe("universal ReBAC OpenFGA tuple builders", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("formats subjects and resources with OpenFGA type:id syntax", () => {
    expect(openFgaSubject({ type: "user", id: "alice-sub" })).toBe("user:alice-sub");
    expect(openFgaSubject({ type: "team", id: "platform", relation: "member" })).toBe(
      "team:platform#member"
    );
    expect(openFgaObject({ type: "slack_channel", id: "T1--C1" })).toBe("slack_channel:T1--C1");
  });

  it("builds Webex OpenFGA space subjects without Slack naming", () => {
    process.env.WEBEX_WORKSPACE_ALIAS = "CAIPE-WEBEX";
    expect(openFgaSubject({ type: "webex_space", id: webexSpaceSubjectId("ignored", "space-1") })).toBe(
      "webex_space:CAIPE-WEBEX--space-1"
    );
    expect(
      buildOpenFgaTuple({
        subject: { type: "webex_space", id: webexSpaceSubjectId("ignored", "space-1") },
        action: "use",
        resource: { type: "agent", id: "incident-triage" },
      })
    ).toEqual({
      user: "webex_space:CAIPE-WEBEX--space-1",
      relation: "user",
      object: "agent:incident-triage",
    });
  });

  it("accepts bot-scoped Webex subjects on agent grants in shipped authorization models", () => {
    const grantRelations: Array<{
      resourceType: string;
      relation: string;
      webexSubjectType: "webex_bot_installation" | "webex_space";
    }> = [
      { resourceType: "agent", relation: "user", webexSubjectType: "webex_bot_installation" },
      { resourceType: "tool", relation: "user", webexSubjectType: "webex_space" },
      { resourceType: "tool", relation: "caller", webexSubjectType: "webex_space" },
      { resourceType: "knowledge_base", relation: "reader", webexSubjectType: "webex_space" },
      { resourceType: "skill", relation: "user", webexSubjectType: "webex_space" },
    ];

    for (const modelPath of AUTHORIZATION_MODEL_PATHS) {
      const model = loadAuthorizationModel(modelPath);
      expect(model.type_definitions?.some((entry) => entry.type === "webex_workspace")).toBe(true);
      expect(model.type_definitions?.some((entry) => entry.type === "webex_space")).toBe(true);
      expect(model.type_definitions?.some((entry) => entry.type === "webex_bot_installation")).toBe(true);

      for (const { resourceType, relation, webexSubjectType } of grantRelations) {
        expectMessagingSubjectParity(modelPath, resourceType, relation, webexSubjectType);
      }
    }
  });

  it("maps universal actions to base writable OpenFGA relation names", () => {
    expect(openFgaRelation("use")).toBe("user");
    expect(openFgaRelation("read-metadata")).toBe("metadata_reader");
    expect(openFgaRelation("call")).toBe("caller");
    expect(openFgaRelation("invoke")).toBe("invoker");
  });

  it("builds a tuple from a validated universal relationship", () => {
    expect(
      buildOpenFgaTuple({
        subject: { type: "team", id: "platform", relation: "member" },
        action: "call",
        resource: { type: "tool", id: "argocd" },
      })
    ).toEqual({
      user: "team:platform#member",
      relation: "caller",
      object: "tool:argocd",
    });
  });

  it("rejects unsupported relationship actions before producing tuples", () => {
    expect(() =>
      buildOpenFgaTuple({
        subject: { type: "team", id: "platform", relation: "member" },
        action: "approve",
        resource: { type: "tool", id: "argocd" },
      })
    ).toThrow("Resource type tool does not support action approve");
  });

  it("builds unique write and delete tuple diffs", () => {
    const relationship = {
      subject: { type: "user" as const, id: "alice-sub" },
      action: "read" as const,
      resource: { type: "knowledge_base" as const, id: "platform-runbooks" },
    };

    expect(
      buildOpenFgaTupleDiff({
        writes: [relationship, relationship],
        deletes: [relationship],
      })
    ).toEqual({
      writes: [
        {
          user: "user:alice-sub",
          relation: "reader",
          object: "knowledge_base:platform-runbooks",
        },
      ],
      deletes: [
        {
          user: "user:alice-sub",
          relation: "reader",
          object: "knowledge_base:platform-runbooks",
        },
      ],
    });
  });
});
