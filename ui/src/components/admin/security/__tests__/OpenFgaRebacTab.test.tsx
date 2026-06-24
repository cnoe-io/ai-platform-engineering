import { render, screen, waitFor } from "@testing-library/react";

import { OpenFgaRebacTab } from "../OpenFgaRebacTab";

const fetchMock = jest.fn();

// ReactFlow needs layout APIs jsdom lacks; the view-only graph renders fine
// without them once these are stubbed.
beforeAll(() => {
  if (!global.ResizeObserver) {
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/admin/openfga/catalog") {
      return jsonResponse({
        data: {
          status: { configured: true, reconcile_enabled: true, store_name: "caipe-openfga" },
          teams: [{ id: "team-1", slug: "platform", name: "Platform" }],
        },
      });
    }
    if (url.startsWith("/api/admin/rebac/graph")) {
      return jsonResponse({
        data: {
          nodes: [
            { id: "team:platform#member", label: "Platform members", type: "userset" },
            { id: "agent:github", label: "GitHub agent", type: "agent" },
          ],
          edges: [
            { id: "e1", from: "team:platform#member", to: "agent:github", relation: "user", kind: "openfga" },
          ],
        },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });
});

it("renders the read-only policy graph with summary metrics", async () => {
  render(<OpenFgaRebacTab isAdmin />);

  await waitFor(() => {
    expect(screen.getByText("Policy Graph")).toBeInTheDocument();
  });

  // Summary reflects the loaded graph (2 nodes, 1 relationship).
  expect(screen.getByText("Relationships")).toBeInTheDocument();
  expect(screen.getByText("OpenFGA reconciliation enabled")).toBeInTheDocument();
});

it("does not expose any grant-editing affordances", async () => {
  render(<OpenFgaRebacTab isAdmin />);

  await waitFor(() => {
    expect(screen.getByText("Policy Graph")).toBeInTheDocument();
  });

  // The editor surfaces (palette, staging, save) are gone.
  expect(screen.queryByTestId("openfga-graph-resource-palette")).not.toBeInTheDocument();
  expect(screen.queryByText(/Validate and save/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Stage revoke/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: /OpenFGA Tuples/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: /Policy Manifest/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("tab", { name: /Default FGA Grants/i })).not.toBeInTheDocument();
});

it("requires admin access", () => {
  render(<OpenFgaRebacTab isAdmin={false} />);
  expect(screen.getByText("Admin access required.")).toBeInTheDocument();
});
