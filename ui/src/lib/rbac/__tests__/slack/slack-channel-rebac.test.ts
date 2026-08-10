// assisted-by Cursor Claude:claude-opus-4-7
import {
  slackChannelGrantRelationship,
  slackChannelTeamVisibilityRelationships,
} from "@/lib/rbac/slack-channel-rebac";

describe("slack-channel-rebac helpers", () => {
  describe("slackChannelGrantRelationship", () => {
    it("models channel -> use -> agent (the outbound grant)", () => {
      const rel = slackChannelGrantRelationship("CAIPE", "C0B4QFN4Q21", {
        type: "agent",
        id: "agent-sre-agent",
      }, "use");

      expect(rel).toEqual({
        subject: { type: "slack_channel", id: "CAIPE--C0B4QFN4Q21" },
        action: "use",
        resource: { type: "agent", id: "agent-sre-agent" },
      });
    });
  });

  describe("slackChannelTeamVisibilityRelationships", () => {
    it("emits team member use/manage and team admin manage tuples", () => {
      // Team selection for Slack integrations intentionally lets every team
      // member view/use the channel and manage its route configuration.
      // assisted-by Codex Codex-sonnet-4-6
      const rels = slackChannelTeamVisibilityRelationships(
        "CAIPE",
        "C0B4QFN4Q21",
        "platform",
      );

      expect(rels).toHaveLength(3);
      expect(rels).toEqual(
        expect.arrayContaining([
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
        ]),
      );
    });

    it("encodes workspace and channel id into the subject id verbatim", () => {
      const rels = slackChannelTeamVisibilityRelationships("ws-1", "ch-1", "team-x");

      for (const rel of rels) {
        expect(rel.resource.id).toBe("ws-1--ch-1");
        expect(rel.resource.type).toBe("slack_channel");
        expect(rel.subject.type).toBe("team");
        expect(rel.subject.id).toBe("team-x");
      }
    });
  });
});
