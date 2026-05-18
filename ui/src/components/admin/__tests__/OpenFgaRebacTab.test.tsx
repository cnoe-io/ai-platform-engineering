import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OpenFgaRebacTab } from "../OpenFgaRebacTab";

const fetchMock = jest.fn();
const replaceMock = jest.fn();
let currentSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => currentSearchParams,
}));

beforeEach(() => {
  fetchMock.mockReset();
  replaceMock.mockReset();
  currentSearchParams = new URLSearchParams();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockImplementation(async (url: string) => {
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
          resources: {
            agents: [{ id: "agent-1", name: "Agent One", description: "", object: "agent:agent-1" }],
            tools: [],
            knowledge_bases: [
              { id: "kb-alpha", name: "KB Alpha", description: "", object: "knowledge_base:kb-alpha" },
            ],
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
              from: "slack_channel:C123",
              to: "agent:agent-1",
              relation: "user",
            },
          ],
        },
      });
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

  expect(await screen.findByRole("tab", { name: "Relationship Builder" })).toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: "Enforcement Status" })).not.toBeInTheDocument();
});

it("defaults to the OpenFGA tuples tab and keeps the tab in the URL", async () => {
  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "OpenFGA Tuples" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(await screen.findByText("OpenFGA Tuple Store")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("tab", { name: "Policy Graph" }));

  expect(replaceMock).toHaveBeenCalledWith("/admin?subtab=graph&openfgaTab=graph", { scroll: false });
});

it("uses a valid OpenFGA tab from the query string", async () => {
  currentSearchParams = new URLSearchParams("subtab=slack");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Slack Channels" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
});

it("shows an OpenFGA permission cheatsheet in the relationship builder", async () => {
  currentSearchParams = new URLSearchParams("openfgaTab=builder");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByText("OpenFGA Permission Cheatsheet")).toBeInTheDocument();
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
  expect(screen.getByTestId("openfga-builder-stacked-layout")).toHaveClass("space-y-4");
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

it("saves RAG datasource admin access as an admin surface tuple", async () => {
  currentSearchParams = new URLSearchParams("openfgaTab=rag");
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/openfga/relationship" && init?.method === "POST") {
      return jsonResponse({ data: { ok: true } });
    }
    if (url === "/api/admin/openfga/catalog") {
      return jsonResponse({
        data: {
          status: { configured: true, reconcile_enabled: true, store_name: "caipe-openfga" },
          teams: [{ id: "team-1", slug: "platform", name: "Platform", members: [], resources: {} }],
          resources: {
            agents: [],
            tools: [],
            knowledge_bases: [
              { id: "kb-alpha", name: "KB Alpha", description: "", object: "knowledge_base:kb-alpha" },
            ],
          },
        },
      });
    }
    if (url.startsWith("/api/admin/openfga/tuples")) {
      return jsonResponse({ data: { tuples: [] } });
    }
    if (url.startsWith("/api/admin/rebac/graph")) return jsonResponse({ data: { nodes: [], edges: [] } });
    return jsonResponse({ data: {} });
  });

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "RAG Team Access" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  fireEvent.click(await screen.findByRole("checkbox", { name: /Data Sources admin/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save RAG Team Access" }));

  expect(await screen.findByText("RAG team access saved to OpenFGA")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/openfga/relationship",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        teamSlug: "platform",
        resourceType: "admin_surface",
        resourceId: "rag_datasources",
        relation: "manager",
        operation: "grant",
      }),
    })
  );
});

