import {
  AUTHORIZATION_POLICIES,
  getAuthorizationPolicy,
  instantiatePolicyRelationships,
  listAuthorizationPolicies,
  listAuthorizationPoliciesByResourceType,
  listAuthorizationPoliciesBySurface,
} from "../authorization-policy-catalog";

describe("authorization policy catalog", () => {
  it("keeps Slack channel team assignment in one policy definition", () => {
    // assisted-by Codex Codex-sonnet-4-6
    const policy = getAuthorizationPolicy("slack_channel_team_assignment_v1");

    expect(policy).toMatchObject({
      title: "Slack channel team assignment",
      trigger: "admin assigns or reassigns a Slack channel to a team",
    });
    expect(policy.grants).toEqual([
      {
        subject: { type: "team", parameter: "teamSlug", relation: "admin" },
        action: "manage",
        resource: { type: "slack_channel", parameter: "slackChannelId" },
      },
      {
        subject: { type: "team", parameter: "teamSlug", relation: "member" },
        action: "use",
        resource: { type: "slack_channel", parameter: "slackChannelId" },
      },
      {
        subject: { type: "team", parameter: "teamSlug", relation: "member" },
        action: "manage",
        resource: { type: "slack_channel", parameter: "slackChannelId" },
      },
    ]);
  });

  it("keeps Webex space team assignment in the same manifest", () => {
    const policy = getAuthorizationPolicy("webex_space_team_assignment_v1");

    expect(policy).toMatchObject({
      family: "messaging_team_assignment",
      surface: "webex",
      title: "Webex space team assignment",
    });
    expect(policy.grants).toEqual([
      {
        subject: { type: "team", parameter: "teamSlug", relation: "admin" },
        action: "manage",
        resource: { type: "webex_space", parameter: "webexSpaceId" },
      },
      {
        subject: { type: "team", parameter: "teamSlug", relation: "member" },
        action: "use",
        resource: { type: "webex_space", parameter: "webexSpaceId" },
      },
    ]);
  });

  it("materializes Slack policy grants into universal ReBAC relationships", () => {
    expect(
      instantiatePolicyRelationships("slack_channel_team_assignment_v1", {
        teamSlug: "platform",
        slackChannelId: "CAIPE--C0B4QFN4Q21",
      })
    ).toEqual([
      {
        subject: { type: "team", id: "platform", relation: "admin" },
        action: "manage",
        resource: { type: "slack_channel", id: "CAIPE--C0B4QFN4Q21" },
      },
      {
        subject: { type: "team", id: "platform", relation: "member" },
        action: "use",
        resource: { type: "slack_channel", id: "CAIPE--C0B4QFN4Q21" },
      },
      {
        subject: { type: "team", id: "platform", relation: "member" },
        action: "manage",
        resource: { type: "slack_channel", id: "CAIPE--C0B4QFN4Q21" },
      },
    ]);
  });

  it("materializes Webex policy grants into universal ReBAC relationships", () => {
    expect(
      instantiatePolicyRelationships("webex_space_team_assignment_v1", {
        teamSlug: "platform",
        webexSpaceId: "WEBEX--space-1",
      })
    ).toEqual([
      {
        subject: { type: "team", id: "platform", relation: "admin" },
        action: "manage",
        resource: { type: "webex_space", id: "WEBEX--space-1" },
      },
      {
        subject: { type: "team", id: "platform", relation: "member" },
        action: "use",
        resource: { type: "webex_space", id: "WEBEX--space-1" },
      },
    ]);
  });

  it("lists policies for future CAS readers by surface or resource type", () => {
    // assisted-by Codex Codex-sonnet-4-6
    expect(listAuthorizationPolicies().map((policy) => policy.id)).toEqual([
      "slack_channel_team_assignment_v1",
      "webex_space_team_assignment_v1",
    ]);
    expect(listAuthorizationPoliciesBySurface("slack").map((policy) => policy.id)).toEqual([
      "slack_channel_team_assignment_v1",
    ]);
    expect(listAuthorizationPoliciesByResourceType("webex_space").map((policy) => policy.id)).toEqual([
      "webex_space_team_assignment_v1",
    ]);
  });

  it("uses stable unique policy ids", () => {
    const ids = AUTHORIZATION_POLICIES.map((policy) => policy.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
