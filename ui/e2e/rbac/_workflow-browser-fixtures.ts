import { expect, type Page } from "@playwright/test";

import type { BuiltinToolsConfigWithIndex } from "../../src/types/dynamic-agent";
import {
  fulfillJson,
  installMockedRbacApp,
  MOCK_RBAC_EMAIL,
  postJson,
  type MockRouteHandler,
} from "./_mocked-rbac";

export const GLOBAL_ACCESS_LABEL = "(all users)";

export const WORKFLOW_PLATFORM_TEAM = {
  _id: "team-platform",
  slug: "platform",
  name: "Platform Team",
};

export const WORKFLOW_OPS_TEAM = {
  _id: "team-ops",
  slug: "ops",
  name: "Ops Team",
};

export const WORKFLOW_ORG_ADMIN_SESSION = {
  email: "admin@caipe.local",
  name: "Platform Admin",
  role: "admin" as const,
  canViewAdmin: true,
};

export const WORKFLOW_TEAM_MEMBER_SESSION = {
  email: "member@caipe.local",
  name: "Team Member",
  role: "user" as const,
  canViewAdmin: false,
};

export const WORKFLOW_OUTSIDER_SESSION = {
  email: "outsider@caipe.local",
  name: "Outside User",
  role: "user" as const,
  canViewAdmin: false,
};

export const WORKFLOW_TEAM_MANAGER_SESSION = {
  email: "manager@caipe.local",
  name: "Team Manager",
  role: "user" as const,
  canViewAdmin: true,
};

export type WorkflowFixture = {
  _id: string;
  name: string;
  description?: string;
  owner_id: string;
  visibility: "private" | "team" | "global";
  shared_with_teams?: string[] | null;
  config_driven?: boolean;
  created_at?: string;
  updated_at?: string;
  steps: Array<{
    type: "step";
    display_text: string;
    agent_id: string;
    prompt: string;
    on_error: "abort" | "retry" | "continue";
    retry?: { max_attempts: number; delay_ms?: number } | null;
    config_override?: Record<string, unknown> | null;
  }>;
};

export type WorkflowAgentFixture = {
  _id: string;
  id: string;
  name: string;
  description?: string;
  allowed_tools?: Record<string, string[] | boolean>;
  builtin_tools?: BuiltinToolsConfigWithIndex;
};

export type WorkflowScenario = {
  workflowId: string;
  workflowName: string;
  visibility: WorkflowFixture["visibility"];
  sharedWithTeams?: string[];
  gapTarget: string;
  expectedGrant: {
    resource: { type: "agent"; id: string };
    grantee: { type: "everyone" } | { type: "team"; id: string };
    capability: "use";
  };
};

export type InstalledWorkflowBrowserMocks = {
  grantRequests: unknown[];
  saveRequests: unknown[];
  runRequests: unknown[];
  /** Authorization header on each POST /api/workflow-runs (empty when absent). */
  runAuthHeaders: string[];
  probeRequests: string[];
  get workflows(): WorkflowFixture[];
};

function filterWorkflowsForPersona(
  workflows: WorkflowFixture[],
  userEmail: string,
  teamSlugs: string[],
): WorkflowFixture[] {
  const normalizedEmail = userEmail.trim().toLowerCase();
  const memberSlugs = new Set(teamSlugs.map((slug) => slug.trim().toLowerCase()));

  return workflows.filter((workflow) => {
    const visibility = workflow.visibility ?? "global";
    if (visibility === "global") return true;
    if (visibility === "team") {
      const shared = workflow.shared_with_teams ?? [];
      if (shared.length === 0) return false;
      return shared.some((slug) => memberSlugs.has(String(slug).trim().toLowerCase()));
    }
    return workflow.owner_id.trim().toLowerCase() === normalizedEmail;
  });
}

export function buildPrivateAgentFixture(): WorkflowAgentFixture {
  return {
    _id: "agent-private",
    id: "agent-private",
    name: "Private agent",
    description: "A private test agent",
  };
}

export function buildMcpWorkflowAgentFixture(): WorkflowAgentFixture {
  return {
    _id: "agent-sre-automation",
    id: "agent-sre-automation",
    name: "SRE Automation Agent",
    description: "Uses Jira MCP tools in workflow steps",
    allowed_tools: {
      "mcp-jira": true,
    },
    builtin_tools: {
      wait: { enabled: true },
    },
  };
}

export function buildDefaultWorkflowCatalog(
  privateAgentId = "agent-private",
): WorkflowFixture[] {
  const privateAgent = buildPrivateAgentFixture();
  const mcpAgent = buildMcpWorkflowAgentFixture();

  return [
    {
      _id: "wf-global-mcp",
      name: "Global SRE workflow",
      description: "Org-wide workflow with MCP-backed agent",
      owner_id: WORKFLOW_ORG_ADMIN_SESSION.email,
      visibility: "global",
      config_driven: false,
      created_at: "2026-06-12T16:00:00.000Z",
      updated_at: "2026-06-12T16:00:00.000Z",
      steps: [
        {
          type: "step",
          display_text: "Probe Jira issues",
          agent_id: mcpAgent.id,
          prompt: "Search open incidents",
          on_error: "abort",
          retry: null,
          config_override: null,
        },
      ],
    },
    {
      _id: "wf-team-platform",
      name: "Platform team workflow",
      description: "Shared with platform team only",
      owner_id: WORKFLOW_ORG_ADMIN_SESSION.email,
      visibility: "team",
      shared_with_teams: [WORKFLOW_PLATFORM_TEAM.slug],
      config_driven: false,
      created_at: "2026-06-12T16:00:00.000Z",
      updated_at: "2026-06-12T16:00:00.000Z",
      steps: [
        {
          type: "step",
          display_text: "Use private agent",
          agent_id: privateAgent.id,
          prompt: "Run the private agent",
          on_error: "abort",
          retry: null,
          config_override: null,
        },
      ],
    },
    {
      _id: "wf-private-member",
      name: "Member private workflow",
      description: "Only visible to the owner",
      owner_id: WORKFLOW_TEAM_MEMBER_SESSION.email,
      visibility: "private",
      config_driven: false,
      created_at: "2026-06-12T16:00:00.000Z",
      updated_at: "2026-06-12T16:00:00.000Z",
      steps: [
        {
          type: "step",
          display_text: "Personal step",
          agent_id: privateAgent.id,
          prompt: "Run privately",
          on_error: "abort",
          retry: null,
          config_override: null,
        },
      ],
    },
  ];
}

export function workflowFixtureFromScenario(
  scenario: WorkflowScenario,
  agentId = "agent-private",
  ownerId = MOCK_RBAC_EMAIL,
): WorkflowFixture {
  return {
    _id: scenario.workflowId,
    name: scenario.workflowName,
    description: "Playwright RBAC fixture",
    owner_id: ownerId,
    visibility: scenario.visibility,
    shared_with_teams: scenario.sharedWithTeams ?? null,
    config_driven: false,
    created_at: "2026-06-12T16:00:00.000Z",
    updated_at: "2026-06-12T16:00:00.000Z",
    steps: [
      {
        type: "step",
        display_text: "Use private agent",
        agent_id: agentId,
        prompt: "Run the private agent",
        on_error: "abort",
        retry: null,
        config_override: null,
      },
    ],
  };
}

/** Synthetic bearer the mocked BFF treats as caipe-platform service account. */
export const WORKFLOW_DELEGATION_SERVICE_BEARER = "Bearer service-account-caipe-platform";

export function workflowDelegationUserBearer(email: string): string {
  return `Bearer user-token:${email}`;
}

function workflowRunAllowedForDelegationBearer(
  authHeader: string,
  workflow: WorkflowFixture,
  teamSlugsByEmail: Record<string, string[]>,
): boolean {
  const header = authHeader.trim();
  if (!header.startsWith("Bearer ")) {
    return false;
  }
  if (
    header === WORKFLOW_DELEGATION_SERVICE_BEARER ||
    header.toLowerCase().includes("service-account")
  ) {
    return workflow.visibility === "global" || workflow.config_driven === true;
  }
  const match = /^Bearer user-token:(.+)$/i.exec(header);
  if (!match?.[1]) {
    return false;
  }
  const email = match[1].trim().toLowerCase();
  if (workflow.owner_id.trim().toLowerCase() === email) {
    return true;
  }
  if (workflow.visibility === "global" || workflow.config_driven) {
    return true;
  }
  if (workflow.visibility === "team") {
    const userTeams = teamSlugsByEmail[email] ?? [];
    const shared = workflow.shared_with_teams ?? [];
    return shared.some((slug) => userTeams.includes(slug));
  }
  return false;
}

export function buildSreAgentWithWorkflowsFixture(
  workflowIds: string[] = ["wf-movie-guessing"],
): WorkflowAgentFixture & {
  _id: string;
  enabled: boolean;
  system_prompt: string;
  model: { id: string; provider: string };
  visibility: "team";
  owner_team_slug: string;
  permissions: { can_manage: boolean; can_write: boolean; can_discover: boolean };
} {
  return {
    _id: "agent-sre-agent",
    id: "agent-sre-agent",
    name: "SRE Agent",
    description: "Routes Webex requests and can trigger workflows",
    enabled: true,
    system_prompt: "You are an SRE assistant.",
    model: { id: "gpt-4o", provider: "openai" },
    visibility: "team",
    owner_team_slug: "platform",
    permissions: { can_manage: true, can_write: true, can_discover: true },
    builtin_tools: {
      workflows: workflowIds,
    } as BuiltinToolsConfigWithIndex,
  };
}

export type WorkflowRunFixture = {
  _id: string;
  workflow_config_id: string;
  workflow_name?: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "waiting_for_input";
  current_step_index?: number;
  started_at?: string;
  completed_at?: string;
  trigger_info?: { triggered_by?: string; user_email?: string };
  steps: Array<{
    type: "step";
    index: number;
    display_text: string;
    agent_id: string;
    status: "pending" | "running" | "completed" | "failed" | "skipped" | "waiting_for_input";
    error?: string | null;
    response?: string | null;
    attempts: number;
  }>;
  events?: Record<string, unknown[]>;
};

export type InstallWorkflowBrowserMocksOptions = {
  session?: {
    email: string;
    name: string;
    role: "admin" | "user";
    canViewAdmin?: boolean;
  };
  isAdmin?: boolean;
  teamSlugs?: string[];
  workflows?: WorkflowFixture[];
  agents?: WorkflowAgentFixture[];
  denyGrants?: boolean;
  /** When true, POST /api/workflow-runs without Bearer returns 401 (SSO-enabled BFF contract). */
  requireBearerForWorkflowRuns?: boolean;
  /**
   * When true, POST /api/workflow-runs enforces visibility RBAC on Bearer identity:
   * service-account tokens may start global workflows only; synthetic user tokens
   * (`Bearer user-token:<email>`) follow owner/team/global rules.
   */
  enforceWorkflowRunDelegation?: boolean;
  /** Team slugs granted to synthetic user-token bearers (email → slugs). */
  delegationTeamSlugsByEmail?: Record<string, string[]>;
  agentAccessGaps?: Array<{
    agentId: string;
    agentName: string;
    teamsWithoutAccess: string[];
  }> | null;
  mcpProbeTools?: Array<{ name: string; description?: string }>;
  /** Returned by GET /api/workflow-runs?run_id=… for workflow run detail pages. */
  workflowRun?: WorkflowRunFixture;
};

export async function installWorkflowBrowserMocks(
  page: Page,
  options: InstallWorkflowBrowserMocksOptions = {},
): Promise<InstalledWorkflowBrowserMocks> {
  const grantRequests: unknown[] = [];
  const saveRequests: unknown[] = [];
  const runRequests: unknown[] = [];
  const runAuthHeaders: string[] = [];
  const probeRequests: string[] = [];

  const session = options.session ?? WORKFLOW_TEAM_MEMBER_SESSION;
  const teamSlugs = options.teamSlugs ?? [WORKFLOW_PLATFORM_TEAM.slug];
  const agents = options.agents ?? [buildPrivateAgentFixture(), buildMcpWorkflowAgentFixture()];
  const allWorkflows = options.workflows ?? buildDefaultWorkflowCatalog();
  const mcpProbeTools = options.mcpProbeTools ?? [
    { name: "search", description: "Search Jira issues" },
    { name: "get_issue", description: "Get issue details" },
  ];

  let workflows =
    options.isAdmin === true
      ? allWorkflows
      : filterWorkflowsForPersona(allWorkflows, session.email, teamSlugs);

  const handler: MockRouteHandler = async ({ route, url, path, method }) => {
    if (path === "/api/dynamic-agents/available" || path === "/api/dynamic-agents") {
      await fulfillJson(route, { data: agents });
      return true;
    }

    if (path === "/api/dynamic-agents/teams") {
      await fulfillJson(route, {
        success: true,
        data: teamSlugs.includes(WORKFLOW_PLATFORM_TEAM.slug)
          ? [WORKFLOW_PLATFORM_TEAM]
          : [],
      });
      return true;
    }

    if (path === "/api/auth/my-roles" && method === "GET") {
      await fulfillJson(route, {
        teams: teamSlugs.map((slug, index) => ({
          _id: `team-${index + 1}`,
          slug,
          name: slug,
        })),
      });
      return true;
    }

    if (path === "/api/dynamic-agents/builtin-tools" && method === "GET") {
      await fulfillJson(route, {
        data: {
          tools: [{ id: "wait", name: "Wait" }],
        },
      });
      return true;
    }

    const agentDetailMatch = path.match(/^\/api\/dynamic-agents\/agents\/([^/]+)$/);
    if (agentDetailMatch && method === "GET") {
      const agentId = decodeURIComponent(agentDetailMatch[1] ?? "");
      const agent = agents.find((item) => item.id === agentId || item._id === agentId);
      await fulfillJson(route, { success: true, data: agent ?? buildPrivateAgentFixture() });
      return true;
    }

    if (path === "/api/mcp-servers" && method === "GET") {
      await fulfillJson(route, {
        success: true,
        data: [
          {
            _id: "mcp-jira",
            name: "Jira MCP",
            transport: "http",
            endpoint: "http://agentgateway:4000/mcp/jira",
            enabled: true,
          },
        ],
      });
      return true;
    }

    if (path === "/api/mcp-servers/probe" && method === "POST") {
      const serverId = url.searchParams.get("id") ?? "";
      probeRequests.push(serverId);
      await fulfillJson(route, {
        success: true,
        data: {
          server_id: serverId,
          success: true,
          tools: mcpProbeTools,
        },
      });
      return true;
    }

    if (path === "/api/workflow-configs/check-agent-access" && method === "POST") {
      const gaps = options.agentAccessGaps ?? [];
      await fulfillJson(route, { gaps });
      return true;
    }

    if (path === "/api/authz/v1/grants" && method === "POST") {
      grantRequests.push(await postJson(route));
      if (options.denyGrants) {
        await fulfillJson(
          route,
          {
            error: `Non-manager ${session.email} cannot manage agent-private`,
          },
          403,
        );
        return true;
      }
      await fulfillJson(route, { success: true });
      return true;
    }

    if (path === "/api/workflow-configs" && method === "GET") {
      await fulfillJson(route, { data: workflows });
      return true;
    }

    if (path === "/api/workflow-configs" && (method === "PUT" || method === "POST")) {
      const body = await postJson(route);
      saveRequests.push(body);
      const payload = body as { _id?: string } | null;
      await fulfillJson(route, {
        data: { id: payload?._id ?? workflows[0]?._id ?? "wf-saved" },
        success: true,
      });
      return true;
    }

    if (
      path === "/api/workflow-runs" &&
      method === "GET" &&
      (url.searchParams.get("run_id") || url.searchParams.get("id"))
    ) {
      const runId = url.searchParams.get("run_id") || url.searchParams.get("id") || "wfrun-playwright-rbac";
      const fixture =
        options.workflowRun ??
        ({
          _id: runId,
          workflow_config_id: workflows[0]?._id ?? "wf-playwright",
          workflow_name: workflows[0]?.name ?? "Playwright workflow",
          status: "running",
          current_step_index: 0,
          started_at: new Date().toISOString(),
          trigger_info: { triggered_by: "webui", user_email: session.email },
          steps: [],
          events: {},
        } satisfies WorkflowRunFixture);
      await fulfillJson(route, {
        ...fixture,
        _id: fixture._id || runId,
        events: fixture.events ?? {},
      });
      return true;
    }

    if (path === "/api/workflow-runs" && method === "GET") {
      await fulfillJson(route, []);
      return true;
    }

    if (path === "/api/workflow-runs" && method === "POST") {
      const headers = route.request().headers();
      const authHeader = headers.authorization ?? headers.Authorization ?? "";
      const body = await postJson(route);

      if (options.requireBearerForWorkflowRuns && !authHeader.startsWith("Bearer ")) {
        await fulfillJson(
          route,
          {
            success: false,
            error: "You are not signed in. Please sign in to continue.",
            code: "NOT_SIGNED_IN",
            reason: "not_signed_in",
            action: "sign_in",
          },
          401,
        );
        return true;
      }

      if (options.enforceWorkflowRunDelegation) {
        const workflowId =
          typeof body === "object" && body !== null && "workflow_config_id" in body
            ? String((body as { workflow_config_id?: string }).workflow_config_id ?? "")
            : "";
        const workflow = allWorkflows.find((item) => item._id === workflowId);
        if (!workflow) {
          await fulfillJson(route, { success: false, error: "Workflow not found", code: "NOT_FOUND" }, 404);
          return true;
        }
        const teamSlugsByEmail = options.delegationTeamSlugsByEmail ?? {
          [WORKFLOW_TEAM_MEMBER_SESSION.email.toLowerCase()]: teamSlugs,
          [WORKFLOW_ORG_ADMIN_SESSION.email.toLowerCase()]: teamSlugs,
        };
        if (!workflowRunAllowedForDelegationBearer(authHeader, workflow, teamSlugsByEmail)) {
          await fulfillJson(
            route,
            {
              success: false,
              error: "You do not have permission to run this workflow.",
              code: "task#use",
              reason: "pdp_denied",
              action: "contact_admin",
            },
            403,
          );
          return true;
        }
      }

      runRequests.push(body);
      runAuthHeaders.push(authHeader || "");
      await fulfillJson(route, { run_id: "wfrun-playwright-rbac", status: "running" }, 201);
      return true;
    }

    return false;
  };

  await installMockedRbacApp(page, {
    isAdmin: options.isAdmin ?? session.role === "admin",
    session,
    handlers: [handler],
  });

  return {
    grantRequests,
    saveRequests,
    runRequests,
    runAuthHeaders,
    probeRequests,
    get workflows() {
      return workflows;
    },
  };
}

export async function openWorkflowEditor(page: Page, workflowName: string): Promise<void> {
  await page.goto("/workflows", { waitUntil: "domcontentloaded" });
  await page.getByText(workflowName).click();
  await expectWorkflowEditorLoaded(page, workflowName);
}

export async function expectWorkflowEditorLoaded(
  page: Page,
  workflowName: string,
): Promise<void> {
  await expect(page.locator('input[placeholder="Workflow name..."]')).toHaveValue(workflowName);
}

export async function runVisibleWorkflow(page: Page): Promise<void> {
  await page.getByText("Run", { exact: true }).click();
}
