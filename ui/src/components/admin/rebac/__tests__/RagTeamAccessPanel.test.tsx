import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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

it("renders the team's current datasource grants and revokes one", async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/openfga/catalog") {
      return jsonResponse({
        data: {
          status: { configured: true, reconcile_enabled: true, store_name: "caipe-openfga" },
          teams: [{ id: "team-1", slug: "platform", name: "Platform", members: [], resources: {} }],
          resources: {
            agents: [],
            tools: [],
            knowledge_bases: [{ id: "kb-alpha", name: "KB Alpha", description: "", object: "knowledge_base:kb-alpha" }],
          },
        },
      });
    }
    // admin_surface probe (limit=1) → not an admin team
    if (url.includes("admin_surface%3Arag_datasources") || url.includes("admin_surface:rag_datasources")) {
      return jsonResponse({ data: { tuples: [] } });
    }
    // member/admin userset grant reads
    if (url.startsWith("/api/admin/openfga/tuples") && url.includes("%23member")) {
      return jsonResponse({
        data: { tuples: [{ key: { user: "team:platform#member", relation: "ingestor", object: "data_source:kb-alpha" } }] },
      });
    }
    if (url.startsWith("/api/admin/openfga/tuples")) {
      return jsonResponse({ data: { tuples: [] } });
    }
    if (url.startsWith("/api/admin/rag/public-datasources")) {
      return jsonResponse({ data: { datasource_id: "kb-alpha", public: false } });
    }
    if (url.includes("/kb-assignments") && init?.method === "DELETE") {
      return jsonResponse({ data: { removed_datasource_id: "kb-alpha" } });
    }
    return jsonResponse({ data: {} });
  });

  render(<RagTeamAccessPanel isAdmin />);

  // The grant row surfaces with its highest permission (ingest). The
  // lowercase "ingest" badge text is unique to the grant list (the add
  // form's <option> renders "Ingest"); the Revoke button only exists per
  // grant row.
  const revokeButton = await screen.findByRole("button", { name: "Revoke" });
  expect(screen.getByText("ingest")).toBeInTheDocument();

  fireEvent.click(revokeButton);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/teams/team-1/kb-assignments?datasource_id=kb-alpha",
      expect.objectContaining({ method: "DELETE" }),
    ),
  );
});

it("saves public datasource state on demand (button, not auto-save)", async () => {
  render(<RagTeamAccessPanel isAdmin />);

  const publicCheckbox = await screen.findByRole("checkbox", {
    name: /Readable by all authenticated users/,
  });
  fireEvent.click(publicCheckbox);
  fireEvent.click(screen.getByRole("button", { name: "Save Public Access" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/rag/public-datasources",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ datasource_id: "kb-alpha", public: true }),
      }),
    ),
  );
});
