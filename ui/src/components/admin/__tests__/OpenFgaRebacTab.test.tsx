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
            knowledge_bases: [],
          },
        },
      });
    }
    if (url.startsWith("/api/admin/openfga/tuples")) {
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

