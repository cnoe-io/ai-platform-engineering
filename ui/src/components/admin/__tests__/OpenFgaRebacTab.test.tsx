import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OpenFgaRebacTab } from "../OpenFgaRebacTab";

const fetchMock = jest.fn();
const replaceMock = jest.fn();
let currentSearchParams = new URLSearchParams();
let rebacCheckAllowed = true;
let lastChangeSetBody: { writes?: unknown[]; deletes?: unknown[] } | null = null;

jest.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => currentSearchParams,
}));

beforeEach(() => {
  fetchMock.mockReset();
  replaceMock.mockReset();
  currentSearchParams = new URLSearchParams();
  rebacCheckAllowed = true;
  lastChangeSetBody = null;
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/openfga/catalog") {
      return jsonResponse({
        data: {
          status: {
            configured: true,
            reconcile_enabled: true,
            store_name: "caipe-openfga",
          },
          teams: [
            {
              id: "team-1",
              slug: "platform",
              name: "Platform",
              members: [],
              resources: {},
            },
          ],
          resource_types: [
            { type: "team", actions: ["read", "manage"], description: "Team scope" },
            { type: "user", actions: ["read", "manage"], description: "User identity" },
            { type: "slack_channel", actions: ["read", "use", "call"], description: "Slack channel" },
            { type: "agent", actions: ["read", "use", "manage"], description: "Agent" },
            { type: "mcp_gateway", actions: ["call"], description: "AgentGateway MCP gateway" },
            { type: "mcp_server", actions: ["read", "invoke", "manage"], description: "MCP server" },
            { type: "tool", actions: ["read", "call", "manage"], description: "Tool" },
            { type: "knowledge_base", actions: ["read", "ingest", "manage"], description: "Knowledge base" },
          ],
          actions: {
            team: ["read", "manage"],
            user: ["read", "manage"],
            slack_channel: ["read", "use", "call"],
            agent: ["read", "use", "manage"],
            mcp_gateway: ["call"],
            mcp_server: ["read", "invoke", "manage"],
            tool: ["read", "call", "manage"],
            knowledge_base: ["read", "ingest", "manage"],
          },
          resources: {
            agents: [{ id: "agent-1", name: "Agent One", description: "", object: "agent:agent-1" }],
            tools: [],
            knowledge_bases: [
              { id: "kb-alpha", name: "KB Alpha", description: "", object: "knowledge_base:kb-alpha" },
            ],
            by_type: {
              team: [{ type: "team", id: "platform", display_name: "Platform", status: "active", enforcement_status: "rebac_shadowed" }],
              user: [{ type: "user", id: "alice-sub", display_name: "Alice Admin", status: "active", enforcement_status: "role_gated" }],
              slack_channel: [
                {
                  type: "slack_channel",
                  id: "CAIPE--C123",
                  display_name: "#incidents",
                  status: "active",
                  enforcement_status: "role_gated",
                  object: "slack_channel:CAIPE--C123",
                },
              ],
              agent: [{ type: "agent", id: "agent-1", display_name: "Agent One", status: "active", enforcement_status: "rebac_shadowed" }],
              mcp_gateway: [{ type: "mcp_gateway", id: "list", display_name: "AgentGateway MCP list", status: "active", enforcement_status: "rebac_shadowed" }],
              mcp_server: [{ type: "mcp_server", id: "argocd", display_name: "Argo CD MCP Server", status: "active", enforcement_status: "role_gated" }],
              tool: [{ type: "tool", id: "argocd/*", display_name: "Argo CD tools", status: "active", enforcement_status: "rebac_shadowed" }],
              knowledge_base: [{ type: "knowledge_base", id: "kb-alpha", display_name: "KB Alpha", status: "active", enforcement_status: "rebac_shadowed" }],
            },
          },
        },
      });
    }
    if (url === "/api/admin/teams/team-1/kb-assignments") {
      return jsonResponse({
        data: {
          team_id: "team-1",
          kb_ids: [],
          kb_permissions: {},
          allowed_datasource_ids: [],
        },
      });
    }
    if (url.startsWith("/api/admin/openfga/tuples")) {
      const parsed = new URL(url, "http://localhost:3000");
      if (
        parsed.searchParams.get("user") === "team:platform#member" &&
        parsed.searchParams.get("relation") === "manager" &&
        parsed.searchParams.get("object") === "admin_surface:rag_datasources"
      ) {
        return jsonResponse({ data: { tuples: [] } });
      }
      return jsonResponse({ data: { tuples: [] } });
    }
    if (url.startsWith("/api/admin/rebac/graph")) {
      return jsonResponse({
        data: {
          nodes: [
            { id: "user:alice-sub", label: "Alice Admin", type: "user" },
            { id: "team:platform", label: "Platform", type: "team" },
            { id: "team:platform#member", label: "Platform members", type: "userset" },
            { id: "slack_channel:C123", label: "#incidents", type: "slack_channel" },
            { id: "agent:agent-1", label: "Agent One", type: "agent" },
            { id: "knowledge_base:kb-alpha", label: "KB Alpha", type: "knowledge_base" },
          ],
          edges: [
            {
              id: "alice-platform",
              from: "user:alice-sub",
              to: "team:platform",
              relation: "member",
            },
            {
              id: "platform-agent",
              from: "team:platform#member",
              to: "agent:agent-1",
              relation: "user",
            },
            {
              id: "platform-kb",
              from: "team:platform#member",
              to: "knowledge_base:kb-alpha",
              relation: "reader",
            },
            {
              id: "slack-agent",
              from: "slack_channel:CAIPE--C123",
              to: "agent:agent-1",
              relation: "user",
            },
            {
              id: "slack-team-routing",
              from: "slack_channel:CAIPE--C123",
              to: "team:platform",
              relation: "assigned_team",
              kind: "metadata",
              metadata: {
                source_type: "slack_channel_team_mapping",
                label: "#incidents assigned to Platform",
                readonly: true,
              },
            },
          ],
        },
      });
    }
    if (url === "/api/admin/users?search=alice&pageSize=20") {
      return jsonResponse({
        users: [
          {
            id: "alice-sub",
            email: "alice@example.com",
            firstName: "Alice",
            lastName: "Admin",
          },
        ],
      });
    }
    if (url === "/api/admin/rebac/check") {
      return jsonResponse({ data: { allowed: rebacCheckAllowed } });
    }
    if (url === "/api/admin/rebac/change-sets") {
      lastChangeSetBody = init?.body ? JSON.parse(String(init.body)) : null;
      return jsonResponse({ data: { change_set: { id: "change-set-1" } } });
    }
    if (url === "/api/admin/rebac/change-sets/change-set-1/validate") {
      return jsonResponse({ data: { validation: { valid: true, blocked: [] } } });
    }
    if (url === "/api/admin/rebac/change-sets/change-set-1/apply") {
      rebacCheckAllowed = (lastChangeSetBody?.writes?.length ?? 0) > 0;
      return jsonResponse({ data: { applied: true } });
    }
    if (url === "/api/admin/slack/channels") {
      return jsonResponse({ data: { channels: [] } });
    }
    if (url === "/api/admin/slack/runtime/status") {
      return jsonResponse({
        data: {
          route_mode: "openfga",
          static_config: { channels: 0, routes: 0 },
          route_cache: { cache_size: 0, ttl_seconds: 60 },
        },
      });
    }
    if (url === "/api/admin/slack/channels/defaults") {
      return jsonResponse({ data: { defaults: { team_id: "", agent_id: "" } } });
    }
    if (url === "/api/admin/webex/spaces") {
      return jsonResponse({ data: { spaces: [] } });
    }
    if (url === "/api/admin/webex/runtime/status") {
      return jsonResponse({
        data: {
          route_mode: "openfga",
          static_config: { spaces: 0, routes: 0 },
          route_cache: { cache_size: 0, ttl_seconds: 60 },
        },
      });
    }
    if (url === "/api/admin/webex/spaces/defaults") {
      return jsonResponse({ data: { defaults: { team_slug: "", agent_id: "" } } });
    }
    if (url === "/api/dynamic-agents?enabled_only=true") {
      return jsonResponse({ data: { items: [] } });
    }
    if (url === "/api/admin/teams") {
      return jsonResponse({ data: { teams: [] } });
    }
    return jsonResponse({ data: {} });
  });
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

it("does not expose the low-value Enforcement Status tab", async () => {
  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Access Manager" })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Enforcement Status" })).not.toBeInTheDocument();
});

it("orders OpenFGA tabs by operational flow and defaults to tuples", async () => {
  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "OpenFGA Tuples" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "OpenFGA Tuples",
    "Policy Graph",
    "Access Manager",
  ]);
  expect(await screen.findByText("OpenFGA Tuple Store")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "Policy Graph" }));

  expect(replaceMock).toHaveBeenCalledWith("/admin?subtab=graph&openfgaTab=graph", { scroll: false });
});

it("falls back to tuples for integration-owned Slack/Webex query strings", async () => {
  currentSearchParams = new URLSearchParams("subtab=slack");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "OpenFGA Tuples" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(screen.queryByRole("tab", { name: "Slack Channels" })).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Webex Spaces" })).not.toBeInTheDocument();
});

it("keeps OpenFGA focused on tuples, graph, and access management", async () => {
  currentSearchParams = new URLSearchParams("subtab=tuples");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Access Manager" })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Relationship Builder" })).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Effective Access" })).not.toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Policy Graph" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "OpenFGA Tuples" })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "RAG Team Access" })).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Slack Channels" })).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Webex Spaces" })).not.toBeInTheDocument();
});

it("maps legacy relationship builder links to the access manager", async () => {
  currentSearchParams = new URLSearchParams("openfgaTab=builder");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Access Manager" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(await screen.findByText("Access Manager Permission Cheatsheet")).toBeInTheDocument();
  expect(screen.getByText("Base relationships you write")).toBeInTheDocument();
  expect(screen.getByText("Derived permissions OpenFGA checks")).toBeInTheDocument();
  expect(screen.getByText(/team:<slug>#member user agent:<id>/)).toBeInTheDocument();
  expect(screen.getAllByText(/use or invoke agent/).length).toBeGreaterThan(0);
  expect(screen.getByText("Subjects and usersets")).toBeInTheDocument();
  expect(screen.getByText("Resource objects")).toBeInTheDocument();
  expect(screen.getByText("user:<sub>")).toBeInTheDocument();
  expect(screen.getByText("team:<slug>#member")).toBeInTheDocument();
  expect(screen.getByText("conversation:<id>")).toBeInTheDocument();
  expect(screen.getByText("system_config:<key>")).toBeInTheDocument();
});

it("starts the policy graph with only team nodes and selected resources visible", async () => {
  const user = userEvent.setup();
  currentSearchParams = new URLSearchParams("openfgaTab=graph");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Policy Graph" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  const canvas = await screen.findByTestId("openfga-graph-canvas");
  expect(within(canvas).getByText("Platform")).toBeInTheDocument();
  expect(within(canvas).getByText("Platform members")).toBeInTheDocument();
  expect(within(canvas).queryByText("Alice Admin")).not.toBeInTheDocument();
  expect(within(canvas).queryByText("Agent One")).not.toBeInTheDocument();

  await user.click(screen.getByRole("checkbox", { name: /Agent One/ }));

  expect(within(canvas).getByText("Agent One")).toBeInTheDocument();
  expect(within(canvas).queryByText("Alice Admin")).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/admin/rebac/graph?limit=1000");
});

it("filters the resource palette search and keeps node and edge details collapsed at the bottom", async () => {
  const user = userEvent.setup();
  currentSearchParams = new URLSearchParams("openfgaTab=graph");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Policy Graph" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(screen.queryByText("team:platform#member reader knowledge_base:kb-alpha")).not.toBeInTheDocument();

  const palette = screen.getByTestId("openfga-graph-resource-palette");
  await user.type(within(palette).getByPlaceholderText("Search resources"), "kb");

  expect(within(palette).queryByRole("checkbox", { name: /Agent One/ })).not.toBeInTheDocument();
  expect(within(palette).getByRole("checkbox", { name: /KB Alpha/ })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Show node and edge details" }));

  expect(
    screen.getByText((_, element) => element?.textContent === "team:platform#member reader knowledge_base:kb-alpha")
  ).toBeInTheDocument();
});

it("shows Slack channel team mappings as read-only routing metadata in the policy graph", async () => {
  const user = userEvent.setup();
  currentSearchParams = new URLSearchParams("openfgaTab=graph");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Policy Graph" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  const canvas = await screen.findByTestId("openfga-graph-canvas");
  const palette = screen.getByTestId("openfga-graph-resource-palette");

  await user.click(within(palette).getByRole("checkbox", { name: /#incidents/ }));

  expect(within(canvas).getByText("#incidents")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Show node and edge details" }));

  expect(screen.getAllByText("slack_channel:CAIPE--C123").length).toBeGreaterThan(0);
  expect(screen.getAllByText("assigned_team").length).toBeGreaterThan(0);
  expect(screen.getAllByText("team:platform").length).toBeGreaterThan(0);
  expect(screen.getByText("routing metadata")).toBeInTheDocument();
});

it("exposes universal catalog resources in the policy graph palette", async () => {
  const user = userEvent.setup();
  currentSearchParams = new URLSearchParams("openfgaTab=graph");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Policy Graph" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  const palette = screen.getByTestId("openfga-graph-resource-palette");

  await user.type(within(palette).getByPlaceholderText("Search resources"), "gateway");

  expect(within(palette).getByText("AgentGateway")).toBeInTheDocument();
  expect(within(palette).getByRole("checkbox", { name: /AgentGateway MCP list/ })).toBeInTheDocument();
});

it("shows selected catalog resources even before they have graph relationships", async () => {
  const user = userEvent.setup();
  currentSearchParams = new URLSearchParams("openfgaTab=graph");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Policy Graph" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  const canvas = await screen.findByTestId("openfga-graph-canvas");
  const palette = screen.getByTestId("openfga-graph-resource-palette");

  expect(within(canvas).queryByText("Argo CD MCP Server")).not.toBeInTheDocument();

  fireEvent.click(within(palette).getByRole("checkbox", { name: /Argo CD MCP Server/ }));

  await waitFor(() => {
    expect(within(canvas).getByText("Argo CD MCP Server")).toBeInTheDocument();
  });
});

it("selects and unselects all currently shown resources in the graph palette", async () => {
  const user = userEvent.setup();
  currentSearchParams = new URLSearchParams("openfgaTab=graph");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Policy Graph" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  const palette = screen.getByTestId("openfga-graph-resource-palette");
  const agent = within(palette).getByRole("checkbox", { name: /Agent One/ });
  const kb = within(palette).getByRole("checkbox", { name: /KB Alpha/ });

  expect(agent).not.toBeChecked();
  expect(kb).not.toBeChecked();

  await user.click(within(palette).getByRole("button", { name: "Select all shown" }));

  expect(agent).toBeChecked();
  expect(kb).toBeChecked();

  await user.click(within(palette).getByRole("button", { name: "Unselect all shown" }));

  expect(agent).not.toBeChecked();
  expect(kb).not.toBeChecked();
});

it("accepts a manual wildcard user subject for the graph filter", async () => {
  const user = userEvent.setup();
  currentSearchParams = new URLSearchParams("openfgaTab=graph");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Policy Graph" })).toHaveAttribute(
    "aria-selected",
    "true"
  );

  const userFilter = screen.getByLabelText("User filter");
  expect(userFilter).toHaveAttribute("autocomplete", "off");

  await user.type(userFilter, "user:*");
  await user.click(screen.getByRole("button", { name: "Use subject" }));
  await user.click(screen.getByRole("button", { name: "Render graph" }));

  expect(await screen.findByText(/Showing graph for/)).toHaveTextContent("user:*");
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/rebac/graph?subject=user%3A*&limit=1000");
  });
});

it("shows the manual user subject controls inside the fullscreen graph", async () => {
  const user = userEvent.setup();
  currentSearchParams = new URLSearchParams("openfgaTab=graph");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Policy Graph" })).toHaveAttribute(
    "aria-selected",
    "true"
  );

  await user.click(screen.getByRole("button", { name: "Full screen" }));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveClass("overflow-hidden");
  const fullscreenCanvas = within(dialog).getByTestId("openfga-graph-canvas");
  expect(fullscreenCanvas).toHaveClass("min-h-0");
  expect(fullscreenCanvas).toHaveClass("min-w-0");
  expect(fullscreenCanvas).not.toHaveClass("min-h-[640px]");

  const fullscreenUserFilter = within(dialog).getByLabelText("User filter");
  expect(fullscreenUserFilter).toHaveAttribute("autocomplete", "off");

  await user.type(fullscreenUserFilter, "user:*");
  await user.click(within(dialog).getByRole("button", { name: "Use subject" }));
  await user.click(within(dialog).getByRole("button", { name: "Render graph" }));

  expect(within(dialog).getByText(/Showing graph for/)).toHaveTextContent("user:*");
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/rebac/graph?subject=user%3A*&limit=1000");
  });
});

it("exposes catalog-backed universal resource types in the access manager", async () => {
  currentSearchParams = new URLSearchParams("openfgaTab=access");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Access Manager" })).toHaveAttribute(
    "aria-selected",
    "true"
  );

  const resourceType = screen.getByLabelText("Resource type");
  expect(within(resourceType).getByRole("option", { name: "Team" })).toBeInTheDocument();
  expect(within(resourceType).getByRole("option", { name: "Slack channel" })).toBeInTheDocument();
  expect(within(resourceType).getByRole("option", { name: "AgentGateway" })).toBeInTheDocument();
  expect(within(resourceType).getByRole("option", { name: "MCP server" })).toBeInTheDocument();
  expect(within(resourceType).getByRole("option", { name: "Tool" })).toBeInTheDocument();
});

it("checks effective access for a searched user subject", async () => {
  const user = userEvent.setup();
  currentSearchParams = new URLSearchParams("openfgaTab=access");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Access Manager" })).toHaveAttribute(
    "aria-selected",
    "true"
  );

  await user.selectOptions(screen.getByLabelText("Subject type"), "user");
  await user.type(screen.getByLabelText("Subject"), "alice");
  await user.click(screen.getByRole("button", { name: "Search subjects" }));
  await user.click(await screen.findByRole("button", { name: /Alice Admin/ }));

  await user.selectOptions(screen.getByLabelText("Resource type"), "agent");
  await user.selectOptions(screen.getByLabelText("Resource"), "agent-1");
  await user.selectOptions(screen.getByLabelText("Action"), "use");
  await user.click(screen.getByRole("button", { name: "Explain effective access" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/rebac/check",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          relationship: {
            subject: { type: "user", id: "alice-sub" },
            action: "use",
            resource: { type: "agent", id: "agent-1" },
          },
        }),
      })
    );
  });
});

it("lets admins grant the selected relationship when effective access is denied", async () => {
  const user = userEvent.setup();
  rebacCheckAllowed = false;
  currentSearchParams = new URLSearchParams("openfgaTab=access");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Access Manager" })).toHaveAttribute(
    "aria-selected",
    "true"
  );

  await user.selectOptions(screen.getByLabelText("Action"), "use");
  await user.click(screen.getByRole("button", { name: "Explain effective access" }));
  expect(await screen.findByText("denied")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Grant this access" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/rebac/change-sets",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Grant effective access use agent:agent-1",
          writes: [
            {
              subject: { type: "team", id: "platform", relation: "member" },
              action: "use",
              resource: { type: "agent", id: "agent-1" },
            },
          ],
          deletes: [],
        }),
      })
    );
  });
  expect(await screen.findByText("allowed")).toBeInTheDocument();
});

it("lets admins revoke the selected relationship when effective access is allowed", async () => {
  const user = userEvent.setup();
  rebacCheckAllowed = true;
  currentSearchParams = new URLSearchParams("openfgaTab=access");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Access Manager" })).toHaveAttribute(
    "aria-selected",
    "true"
  );

  await user.selectOptions(screen.getByLabelText("Action"), "use");
  await user.click(screen.getByRole("button", { name: "Explain effective access" }));
  expect(await screen.findByText("allowed")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Revoke this access" }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/rebac/change-sets",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Revoke effective access use agent:agent-1",
          writes: [],
          deletes: [
            {
              subject: { type: "team", id: "platform", relation: "member" },
              action: "use",
              resource: { type: "agent", id: "agent-1" },
            },
          ],
        }),
      })
    );
  });
  expect(await screen.findByText("denied")).toBeInTheDocument();
});

