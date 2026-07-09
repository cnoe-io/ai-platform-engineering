import { render, screen, waitFor } from "@testing-library/react";

import { AccessExplorerTab } from "../AccessExplorerTab";

// assisted-by Codex Codex-sonnet-4-6

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

it("renders the access explorer search bar", () => {
  render(<AccessExplorerTab isAdmin />);
  expect(screen.queryByRole("heading", { name: "Access Explorer" })).not.toBeInTheDocument();
  expect(screen.getByPlaceholderText(/Search users, teams, agents/i)).toBeInTheDocument();
});

it("does not expose any grant-editing affordances", () => {
  render(<AccessExplorerTab isAdmin />);

  expect(screen.queryByTestId("openfga-graph-resource-palette")).not.toBeInTheDocument();
  expect(screen.queryByText(/Validate and save/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Stage revoke/i)).not.toBeInTheDocument();
});

it("requires admin access", () => {
  render(<AccessExplorerTab isAdmin={false} />);
  expect(screen.getByText("Admin access required.")).toBeInTheDocument();
});
