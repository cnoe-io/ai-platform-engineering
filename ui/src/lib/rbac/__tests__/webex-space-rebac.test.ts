// assisted-by Cursor Claude:claude-opus-4-7
import {
  webexSpaceGrantRelationship,
  webexSpaceTeamVisibilityRelationships,
} from "@/lib/rbac/webex-space-rebac";

describe("webex-space-rebac helpers", () => {
  describe("webexSpaceGrantRelationship", () => {
    it("models space -> use -> agent (the outbound grant)", () => {
      const rel = webexSpaceGrantRelationship("WEBEX", "space-1", {
        type: "agent",
        id: "agent-sre-agent",
      }, "use");

      expect(rel).toEqual({
        subject: { type: "webex_space", id: "WEBEX--space-1" },
        action: "use",
        resource: { type: "agent", id: "agent-sre-agent" },
      });
    });
  });

  describe("webexSpaceTeamVisibilityRelationships", () => {
    it("emits a team#admin -> manage and team#member -> use pair", () => {
      // Mirrors the Slack helper: `use` (relation `user`) for member rather than
      // `read` (relation `reader`) so this matches the existing team-spaces PUT
      // endpoint and the two onboarding paths converge on identical tuples.
      const rels = webexSpaceTeamVisibilityRelationships(
        "WEBEX",
        "space-1",
        "platform",
      );

      expect(rels).toHaveLength(2);
      expect(rels).toEqual(
        expect.arrayContaining([
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
        ]),
      );
    });

    it("mirrors the Slack helper shape so parity tests can compare them", () => {
      const rels = webexSpaceTeamVisibilityRelationships("w", "s", "t");
      const actions = rels.map((r) => r.action).sort();
      const subjectRelations = rels.map((r) => r.subject.relation).sort();
      expect(actions).toEqual(["manage", "use"]);
      expect(subjectRelations).toEqual(["admin", "member"]);
    });
  });
});
