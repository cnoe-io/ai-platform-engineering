// assisted-by Codex Codex-sonnet-4-6

import type { DynamicAgentConfig } from "@/types/dynamic-agent";

import {
  filterAgentsByOwnershipScope,
  isAgentInOwnershipScope,
  type AgentOwnershipScopeContext,
} from "../agent-ownership-scope";

function ctx(overrides: Partial<AgentOwnershipScopeContext> = {}): AgentOwnershipScopeContext {
  return {
    userSub: "generic-sub",
    teamSlugs: new Set(["platform"]),
    platformDefaultAgentId: null,
    ...overrides,
  };
}

function agent(
  overrides: Partial<DynamicAgentConfig> & { _id: string },
): DynamicAgentConfig {
  return {
    name: overrides._id,
    description: "",
    system_prompt: "test",
    allowed_tools: {},
    model: { id: "gpt-4o", provider: "openai" },
    visibility: "team",
    subagents: [],
    skills: [],
    enabled: true,
    owner_id: "owner-sub",
    owner_team_slug: "super-admins",
    shared_with_teams: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as DynamicAgentConfig;
}

describe("isAgentInOwnershipScope", () => {
  it("includes global agents for any user", () => {
    expect(
      isAgentInOwnershipScope(agent({ _id: "hello-world", visibility: "global" }), ctx()),
    ).toBe(true);
  });

  it("includes the configured platform default agent even when team-scoped", () => {
    expect(
      isAgentInOwnershipScope(
        agent({ _id: "sre-agent", visibility: "team", owner_team_slug: "super-admins" }),
        ctx({ platformDefaultAgentId: "sre-agent", teamSlugs: new Set() }),
      ),
    ).toBe(true);
  });

  it("includes team agents owned by the user's teams", () => {
    expect(
      isAgentInOwnershipScope(
        agent({ _id: "team-agent", owner_team_slug: "platform" }),
        ctx(),
      ),
    ).toBe(true);
  });

  it("includes agents explicitly shared with the user's team", () => {
    expect(
      isAgentInOwnershipScope(
        agent({
          _id: "shared-agent",
          owner_team_slug: "super-admins",
          shared_with_teams: ["platform"],
        }),
        ctx(),
      ),
    ).toBe(true);
  });

  it("includes agents owned directly by the user", () => {
    expect(
      isAgentInOwnershipScope(
        agent({ _id: "mine", owner_id: "generic-sub", owner_team_slug: "super-admins" }),
        ctx(),
      ),
    ).toBe(true);
  });

  it("excludes other teams' agents for a generic member", () => {
    expect(
      isAgentInOwnershipScope(
        agent({ _id: "private-project", name: "Private Project Agent", owner_team_slug: "super-admins" }),
        ctx(),
      ),
    ).toBe(false);
    expect(
      isAgentInOwnershipScope(
        agent({ _id: "test4-argocd", name: "Test4 ArgoCD", owner_team_slug: "sre" }),
        ctx(),
      ),
    ).toBe(false);
  });
});

describe("filterAgentsByOwnershipScope", () => {
  it("keeps only in-scope agents", () => {
    const agents = [
      agent({ _id: "hello-world", visibility: "global" }),
      agent({ _id: "private-project", owner_team_slug: "super-admins" }),
      agent({ _id: "platform-agent", owner_team_slug: "platform" }),
    ];
    const filtered = filterAgentsByOwnershipScope(agents, ctx());
    expect(filtered.map((a) => a._id)).toEqual(["hello-world", "platform-agent"]);
  });
});
