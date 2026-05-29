import { fireEvent, render, screen } from "@testing-library/react";

import { RagTeamAccessPanel } from "../RagTeamAccessPanel";

const fetchMock = jest.fn();

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/openfga/relationship" && init?.method === "POST") {
      return jsonResponse({ data: { ok: true } });
    }
    if (url === "/api/admin/openfga/catalog") {
      return jsonResponse({
        data: {
          status: { configured: true, reconcile_enabled: true, store_name: "caipe-openfga" },
          teams: [
            { id: "team-1", slug: "platform", name: "Platform", members: [], resources: {} },
          ],
          resources: {
            agents: [],
            tools: [],
            knowledge_bases: [
              {
                id: "kb-alpha",
                name: "KB Alpha",
                description: "",
                object: "knowledge_base:kb-alpha",
              },
            ],
          },
        },
      });
    }
    if (url.startsWith("/api/admin/openfga/tuples")) {
      return jsonResponse({ data: { tuples: [] } });
    }
    if (url === "/api/admin/teams/team-1/kb-assignments" && init?.method === "PUT") {
      return jsonResponse({ data: { ok: true } });
    }
    if (url === "/api/admin/teams/team-1/kb-assignments") {
      return jsonResponse({
        data: {
          team_id: "team-1",
          kb_ids: [],
          kb_permissions: {},
        },
      });
    }
    if (url.startsWith("/api/admin/rebac/graph")) {
      return jsonResponse({ data: { nodes: [], edges: [] } });
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

it("saves RAG datasource admin access as an admin surface tuple", async () => {
  render(<RagTeamAccessPanel isAdmin />);

  expect(await screen.findByText("RAG Team Access")).toBeInTheDocument();
  // Team picker is now a searchable TeamPicker (2026-05-27) so the
  // options aren't in the DOM until the popover opens. Confirm the
  // selected team is rendered on the trigger label instead.
  expect(await screen.findByLabelText("Team")).toHaveTextContent(/Platform/);
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

it("grants a selected knowledge base to the selected team", async () => {
  render(<RagTeamAccessPanel isAdmin />);

  expect(await screen.findByText("RAG Team Access")).toBeInTheDocument();
  fireEvent.change(await screen.findByLabelText("Knowledge Base"), {
    target: { value: "kb-alpha" },
  });
  fireEvent.change(screen.getByLabelText("Permission"), {
    target: { value: "admin" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Grant KB Access" }));

  expect(await screen.findByText("Knowledge Base access saved to OpenFGA")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/teams/team-1/kb-assignments",
    expect.objectContaining({
      method: "PUT",
      body: JSON.stringify({
        kb_ids: ["kb-alpha"],
        kb_permissions: { "kb-alpha": "admin" },
      }),
    })
  );
});
