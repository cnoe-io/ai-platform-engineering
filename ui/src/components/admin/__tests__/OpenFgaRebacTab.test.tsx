import { fireEvent, render, screen } from "@testing-library/react";

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
            { id: "slack_channel:C123", label: "#incidents", type: "slack_channel" },
            { id: "agent:agent-1", label: "Agent One", type: "agent" },
          ],
          edges: [
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

it("shows Slack channel graph nodes from the universal ReBAC graph", async () => {
  currentSearchParams = new URLSearchParams("openfgaTab=graph");

  render(<OpenFgaRebacTab isAdmin />);

  expect(await screen.findByRole("tab", { name: "Policy Graph" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(await screen.findAllByText("Slack Channel")).not.toHaveLength(0);
  expect(screen.getAllByText("#incidents")).not.toHaveLength(0);
  expect(fetchMock).toHaveBeenCalledWith("/api/admin/rebac/graph?limit=1000");
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

