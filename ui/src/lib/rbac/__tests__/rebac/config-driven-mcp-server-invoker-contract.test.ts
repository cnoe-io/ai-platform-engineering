/**
 * Config-driven MCP server invoke policy (org-wide discover, admin/owner invoke).
 *
 * Evaluates the REAL tuple projection from `buildConfigDrivenMcpServerRelationshipTupleDiff`
 * and `buildMcpServerRelationshipTupleDiff` against the deployed `mcp_server` permission
 * graph so org members can probe default servers but not test/invoke them directly.
 *
 * assisted-by Cursor composer-2.5
 */

import { readFileSync } from "fs";
import { join } from "path";

import {
  buildConfigDrivenMcpServerRelationshipTupleDiff,
  buildMcpServerRelationshipTupleDiff,
} from "@/lib/rbac/openfga-owned-resources";

const SERVER_ID = "argocd";
const ORG_ID = "caipe";
const MEMBER_SUB = "member-sub";
const ADMIN_SUB = "admin-sub";

const REPO_ROOT = join(__dirname, "..", "..", "..", "..", "..", "..");
const CHART_JSON = join(
  REPO_ROOT,
  "charts",
  "ai-platform-engineering",
  "charts",
  "openfga",
  "authorization-model.json",
);

interface ChildUserset {
  computedUserset?: { relation?: string };
  tupleToUserset?: { computedUserset?: { relation?: string } };
}

function chartUnionMembers(perm: string): string[] {
  const model = JSON.parse(readFileSync(CHART_JSON, "utf8")) as {
    type_definitions: Array<{
      type: string;
      relations?: Record<string, { union?: { child?: ChildUserset[] } }>;
    }>;
  };
  const mcpServer = model.type_definitions.find((t) => t.type === "mcp_server");
  const def = mcpServer?.relations?.[perm];
  const children = def?.union?.child ?? [];
  return children
    .map((c) => c.computedUserset?.relation ?? c.tupleToUserset?.computedUserset?.relation)
    .filter((r): r is string => Boolean(r));
}

function directRelationsFromDiff(
  diff: { writes: Array<{ user: string; relation: string; object: string }> },
  subject: string,
): Set<string> {
  return new Set(
    diff.writes.filter((t) => t.user === subject && t.object === `mcp_server:${SERVER_ID}`).map((t) => t.relation),
  );
}

function resolveMcpServerPermissions(direct: Set<string>) {
  const owner = direct.has("owner");
  const canManage = direct.has("manager") || owner;
  const canInvoke = direct.has("invoker") || canManage || owner;
  const canUse = direct.has("user") || canInvoke || canManage || owner;
  const canRead = direct.has("reader") || canUse || canManage || owner;
  return {
    discover: canRead,
    read: canRead,
    invoke: canInvoke,
    manage: canManage,
  };
}

describe("mcp_server permission graph matches invoke policy resolver", () => {
  it("can_invoke = invoker ∪ can_manage ∪ owner", () => {
    expect(chartUnionMembers("can_invoke").sort()).toEqual(["can_manage", "invoker", "owner"].sort());
  });

  it("can_read = reader ∪ can_use ∪ can_manage ∪ owner", () => {
    expect(chartUnionMembers("can_read").sort()).toEqual(
      ["can_manage", "can_use", "owner", "reader"].sort(),
    );
  });
});

describe("config-driven MCP server invoke policy", () => {
  const configDiff = buildConfigDrivenMcpServerRelationshipTupleDiff({
    serverId: SERVER_ID,
    organizationId: ORG_ID,
  });

  it("does not grant org members invoker on config-driven servers", () => {
    expect(configDiff.writes).not.toEqual(
      expect.arrayContaining([
        {
          user: `organization:${ORG_ID}#member`,
          relation: "invoker",
          object: `mcp_server:${SERVER_ID}`,
        },
      ]),
    );
    expect(configDiff.deletes).toEqual([
      {
        user: `organization:${ORG_ID}#member`,
        relation: "invoker",
        object: `mcp_server:${SERVER_ID}`,
      },
    ]);
  });

  it("org member can discover but not invoke default servers", () => {
    const memberDirect = directRelationsFromDiff(configDiff, `organization:${ORG_ID}#member`);
    const perms = resolveMcpServerPermissions(memberDirect);
    expect(perms).toEqual({ discover: true, read: true, invoke: false, manage: false });
  });

  it("org admin can invoke and manage default servers", () => {
    const adminDirect = directRelationsFromDiff(configDiff, `organization:${ORG_ID}#admin`);
    const perms = resolveMcpServerPermissions(adminDirect);
    expect(perms).toEqual({ discover: true, read: true, invoke: true, manage: true });
  });
});

describe("user-created MCP server invoke policy", () => {
  const ownerDiff = buildMcpServerRelationshipTupleDiff({
    serverId: "mcp-user-created",
    ownerSubject: MEMBER_SUB,
  });

  it("grants owner invoke on servers they created", () => {
    const ownerDirect = new Set(
      ownerDiff.writes
        .filter((t) => t.user === `user:${MEMBER_SUB}` && t.object === "mcp_server:mcp-user-created")
        .map((t) => t.relation),
    );
    const perms = resolveMcpServerPermissions(ownerDirect);
    expect(perms.invoke).toBe(true);
    expect(perms.manage).toBe(true);
  });

  it("grants org admin invoke without org-member invoker", () => {
    const adminDirect = new Set(
      ownerDiff.writes
        .filter((t) => t.user === `organization:${ORG_ID}#admin` && t.object === "mcp_server:mcp-user-created")
        .map((t) => t.relation),
    );
    const perms = resolveMcpServerPermissions(adminDirect);
    expect(perms.invoke).toBe(true);
    expect(adminDirect.has("invoker")).toBe(false);
  });
});
