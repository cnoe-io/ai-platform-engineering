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
    it("emits a team#admin -> manage and team#member -> use pair", () => {
      // We use action `use` (not `read`) for the member tuple because that's what
      // the team-channels PUT endpoint at
      // `ui/src/app/api/admin/teams/[id]/slack-channels/route.ts` writes
      // (`team:<slug>#member relation user slack_channel:...`). Keeping the same
      // shape means the admin PUT path and the onboarding-defaults backfill path
      // converge on identical OpenFGA tuple sets. `can_use` resolves through to
      // `can_read` in the slack_channel type model.
      const rels = slackChannelTeamVisibilityRelationships(
        "CAIPE",
        "C0B4QFN4Q21",
        "platform",
      );

      expect(rels).toHaveLength(2);
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
