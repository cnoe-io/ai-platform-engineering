/**
 * @jest-environment node
 *
 * Comprehensive MCP OpenFGA tuple contract tests.
 *
 * Guards the alignment between:
 * - Team Resources UI selections (`<server_id>_*` in Mongo)
 * - BFF authorization (`mcp_server:<id>#can_read` / `#can_manage`)
 * - AgentGateway extAuthz (`tool:<id>/*#can_call`)
 * - MCP server lifecycle (create owner, delete cleanup targets)
 *
 * Pure tuple builders only — no Mongo/CAS imports.
 */

import { buildTeamResourceTupleDiff } from "../openfga";
import {
  buildMcpServerRelationshipTupleDiff,
  type OwnerSubjectKind,
} from "../openfga-owned-resources";

const TEAM = "platform-engineering";

function mcpServerSelection(serverId: string): string {
  return `${serverId}_*`;
}

function teamMcpGrantObjects(serverId: string): string[] {
  return [`mcp_server:${serverId}`, `tool:${serverId}/*`];
}

function legacyMcpGrantObjects(serverId: string): string[] {
  return [`mcp_tool:${serverId}_*`, `tool:${serverId}_*`];
}

describe("MCP OpenFGA tuple contract", () => {
  describe("team resources → runtime tuple alignment", () => {
    it("writes BFF mcp_server grants and gateway tool:<id>/* caller for MCP server selections", () => {
      const serverId = "mcp-confluence-mcp";
      const selection = mcpServerSelection(serverId);
      const diff = buildTeamResourceTupleDiff({
        teamSlug: TEAM,
        memberUserIds: [],
        agents: { added: [], removed: [] },
        agentAdmins: { added: [], removed: [] },
        tools: { added: [selection], removed: [] },
        toolWildcard: { added: false, removed: false },
      });

      expect(diff.writes).toEqual(
        expect.arrayContaining([
          { user: `team:${TEAM}#member`, relation: "reader", object: `mcp_server:${serverId}` },
          { user: `team:${TEAM}#member`, relation: "user", object: `mcp_server:${serverId}` },
          { user: `team:${TEAM}#member`, relation: "invoker", object: `mcp_server:${serverId}` },
          { user: `team:${TEAM}#admin`, relation: "manager", object: `mcp_server:${serverId}` },
          { user: "organization:caipe#admin", relation: "manager", object: `mcp_server:${serverId}` },
          { user: `team:${TEAM}#member`, relation: "caller", object: `tool:${serverId}/*` },
        ]),
      );

      for (const object of legacyMcpGrantObjects(serverId)) {
        expect(diff.writes).not.toEqual(
          expect.arrayContaining([expect.objectContaining({ object })]),
        );
      }

      expect(diff.writes).not.toEqual(
        expect.arrayContaining([
          { user: `team:${TEAM}#member`, relation: "caller", object: selection },
        ]),
      );
    });

    it("writes agent:<id> caller tool:<server>/* for team-assigned agents (AgentGateway runtime)", () => {
      const serverId = "mcp-confluence-mcp";
      const selection = mcpServerSelection(serverId);
      const diff = buildTeamResourceTupleDiff({
        teamSlug: TEAM,
        memberUserIds: [],
        agents: { added: ["agent-platform-helper"], removed: [] },
        agentAdmins: { added: [], removed: [] },
        tools: { added: [selection], removed: [] },
        toolWildcard: { added: false, removed: false },
      });

      expect(diff.writes).toEqual(
        expect.arrayContaining([
          {
            user: "agent:agent-platform-helper",
            relation: "caller",
            object: `tool:${serverId}/*`,
          },
        ]),
      );
    });

    it("revokes agent runtime caller tuples when MCP server or agent is removed", () => {
      const serverId = "mcp-litellm";
      const selection = mcpServerSelection(serverId);
      const diff = buildTeamResourceTupleDiff({
        teamSlug: TEAM,
        memberUserIds: [],
        agents: { added: ["agent-keep"], removed: ["agent-drop"] },
        agentAdmins: { added: [], removed: [] },
        tools: { added: [], removed: [selection] },
        toolWildcard: { added: false, removed: false },
      });

      expect(diff.deletes).toEqual(
        expect.arrayContaining([
          { user: "agent:agent-drop", relation: "caller", object: `tool:${serverId}/*` },
          { user: "agent:agent-keep", relation: "caller", object: `tool:${serverId}/*` },
        ]),
      );
    });

    it("expands tool wildcard to per-server agent tuples AgentGateway can check", () => {
      const diff = buildTeamResourceTupleDiff({
        teamSlug: TEAM,
        memberUserIds: [],
        agents: { added: ["agent-a"], removed: [] },
        agentAdmins: { added: [], removed: [] },
        tools: { added: [], removed: [] },
        toolWildcard: { added: true, removed: false },
        allMcpServerIds: ["mcp-jira", "mcp-rag"],
      });

      expect(diff.writes).toEqual(
        expect.arrayContaining([
          { user: "agent:agent-a", relation: "caller", object: "tool:mcp-jira/*" },
          { user: "agent:agent-a", relation: "caller", object: "tool:mcp-rag/*" },
          { user: `team:${TEAM}#member`, relation: "caller", object: "tool:mcp-jira/*" },
          { user: `team:${TEAM}#member`, relation: "caller", object: "tool:mcp-rag/*" },
        ]),
      );
      expect(diff.writes).not.toEqual(
        expect.arrayContaining([
          { user: "agent:agent-a", relation: "caller", object: "tool:*" },
        ]),
      );
    });

    it("revokes per-server wildcard agent tuples when an agent is removed but wildcard stays on", () => {
      const diff = buildTeamResourceTupleDiff({
        teamSlug: TEAM,
        memberUserIds: [],
        agents: { added: ["agent-keep"], removed: ["agent-drop"] },
        agentAdmins: { added: [], removed: [] },
        tools: { added: [], removed: [] },
        toolWildcard: { added: true, removed: false },
        allMcpServerIds: ["mcp-jira", "mcp-rag"],
      });

      expect(diff.deletes).toEqual(
        expect.arrayContaining([
          { user: "agent:agent-drop", relation: "caller", object: "tool:mcp-jira/*" },
          { user: "agent:agent-drop", relation: "caller", object: "tool:mcp-rag/*" },
          { user: "agent:agent-drop", relation: "caller", object: "tool:*" },
        ]),
      );
    });

    it("revokes direct tool grants for removed agents", () => {
      const diff = buildTeamResourceTupleDiff({
        teamSlug: TEAM,
        memberUserIds: [],
        agents: { added: ["agent-keep"], removed: ["agent-drop"] },
        agentAdmins: { added: [], removed: [] },
        tools: { added: ["jira/search"], removed: [] },
        toolWildcard: { added: false, removed: false },
      });

      expect(diff.deletes).toEqual(
        expect.arrayContaining([
          { user: "agent:agent-drop", relation: "caller", object: "tool:jira/search" },
        ]),
      );
    });

    it("revokes runtime and legacy tuples when a team unassigns an MCP server", () => {
      const serverId = "mcp-litellm";
      const selection = mcpServerSelection(serverId);
      const diff = buildTeamResourceTupleDiff({
        teamSlug: TEAM,
        memberUserIds: [],
        agents: { added: [], removed: [] },
        agentAdmins: { added: [], removed: [] },
        tools: { added: [], removed: [selection] },
        toolWildcard: { added: false, removed: false },
      });

      expect(diff.deletes).toEqual(
        expect.arrayContaining([
          { user: `team:${TEAM}#member`, relation: "caller", object: `tool:${serverId}/*` },
          { user: `team:${TEAM}#member`, relation: "caller", object: `tool:${selection}` },
          { user: `team:${TEAM}#member`, relation: "reader", object: `mcp_tool:${selection}` },
          { user: `team:${TEAM}#member`, relation: "caller", object: `mcp_tool:${selection}` },
          { user: `team:${TEAM}#admin`, relation: "manager", object: `mcp_tool:${selection}` },
        ]),
      );
      expect(diff.deletes).not.toContainEqual({
        user: "organization:caipe#admin",
        relation: "manager",
        object: `mcp_server:${serverId}`,
      });
    });

    it("keeps non-wildcard tool ids on the legacy tool: object type", () => {
      const diff = buildTeamResourceTupleDiff({
        teamSlug: TEAM,
        memberUserIds: [],
        agents: { added: [], removed: [] },
        agentAdmins: { added: [], removed: [] },
        tools: { added: ["jira/search"], removed: [] },
        toolWildcard: { added: false, removed: false },
      });

      expect(diff.writes).toEqual([
        { user: `team:${TEAM}#member`, relation: "caller", object: "tool:jira/search" },
      ]);
      expect(diff.writes).not.toEqual(
        expect.arrayContaining([expect.objectContaining({ object: expect.stringContaining("mcp_server:") })]),
      );
    });

    it("matches the drift-repair PUT body used by admin Team Resources for MCP servers", () => {
      const diff = buildTeamResourceTupleDiff({
        teamSlug: TEAM,
        memberUserIds: ["kc-alice", "kc-bob"],
        agents: { added: ["agent-keep"], removed: [] },
        agentAdmins: { added: [], removed: [] },
        tools: { added: ["mcp-confluence-mcp_*"], removed: [] },
        toolWildcard: { added: false, removed: false },
      });

      expect(diff.writes).toEqual(
        expect.arrayContaining([
          { user: "user:kc-alice", relation: "member", object: `team:${TEAM}` },
          { user: "user:kc-bob", relation: "member", object: `team:${TEAM}` },
          { user: `team:${TEAM}#member`, relation: "caller", object: "tool:mcp-confluence-mcp/*" },
          { user: `team:${TEAM}#admin`, relation: "manager", object: "mcp_server:mcp-confluence-mcp" },
          {
            user: "agent:agent-keep",
            relation: "caller",
            object: "tool:mcp-confluence-mcp/*",
          },
        ]),
      );
    });
  });

  describe("MCP server create ownership tuples", () => {
    it.each<[OwnerSubjectKind, string]>([
      ["user", "user:alice-sub"],
      ["service_account", "service_account:bot-client-id"],
    ])("writes %s owner on mcp_server create", (kind, expectedUser) => {
      const diff = buildMcpServerRelationshipTupleDiff({
        serverId: "mcp-ops-tools",
        ownerSubject: kind === "user" ? "alice-sub" : "bot-client-id",
        ownerSubjectKind: kind,
      });

      expect(diff.writes).toEqual(
        expect.arrayContaining([
          { user: expectedUser, relation: "owner", object: "mcp_server:mcp-ops-tools" },
          { user: "organization:caipe#admin", relation: "manager", object: "mcp_server:mcp-ops-tools" },
        ]),
      );
    });

    it("grants owner team reader/user/invoker on team-owned servers", () => {
      const diff = buildMcpServerRelationshipTupleDiff({
        serverId: "mcp-team-tools",
        ownerSubject: "alice-sub",
        ownerTeamSlug: "platform",
      });

      expect(diff.writes).toEqual(
        expect.arrayContaining([
          { user: "team:platform#member", relation: "reader", object: "mcp_server:mcp-team-tools" },
          { user: "team:platform#member", relation: "user", object: "mcp_server:mcp-team-tools" },
          { user: "team:platform#member", relation: "invoker", object: "mcp_server:mcp-team-tools" },
          { user: "team:platform#admin", relation: "manager", object: "mcp_server:mcp-team-tools" },
        ]),
      );
    });
  });

  describe("delete cleanup object inventory", () => {
    it("lists every OpenFGA object pattern removed on MCP server delete", () => {
      const serverId = "mcp-confluence-mcp";
      const deleteTargets = [
        `mcp_server:${serverId}`,
        `mcp_tool:${serverId}_*`,
        `tool:${serverId}_*`,
        `tool:${serverId}/*`,
      ];

      expect(deleteTargets).toEqual(
        expect.arrayContaining([
          ...teamMcpGrantObjects(serverId).filter((object) => object.startsWith("mcp_server:")),
          ...legacyMcpGrantObjects(serverId),
          `tool:${serverId}/*`,
        ]),
      );
      expect(deleteTargets).toHaveLength(4);
    });
  });
});
