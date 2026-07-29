/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IngestionSourceConfigWithPermissions } from "@/types/ingestion-source";

jest.mock("@/components/rbac/TeamOwnershipFields", () => ({
  TeamOwnershipFields: ({
    ownerTeamSlug,
    onOwnerTeamChange,
  }: {
    ownerTeamSlug: string;
    onOwnerTeamChange: (slug: string) => void;
  }) => (
    <input
      data-testid="mock-owner-team"
      value={ownerTeamSlug}
      onChange={(e) => onOwnerTeamChange(e.target.value)}
    />
  ),
}));

const mockUseRagPermissions = jest.fn();
jest.mock("@/hooks/useRagPermissions", () => ({
  useRagPermissions: () => mockUseRagPermissions(),
}));

import IngestionSourcesView from "../IngestionSourcesView";

function makeSource(
  overrides: Partial<IngestionSourceConfigWithPermissions> = {},
): IngestionSourceConfigWithPermissions {
  return {
    source_id: "slack-channel-C1",
    source_type: "slack_channel",
    channel_id: "C1",
    name: "example-channel",
    description: "",
    status: "active",
    default_chunk_size: 10000,
    default_chunk_overlap: 2000,
    reload_interval: 86400,
    config_driven: false,
    config_import_adopted: false,
    visibility: "team",
    owner_team_slug: "team-example",
    shared_with_teams: [],
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    _permissions: { can_manage: true },
    ...overrides,
  } as IngestionSourceConfigWithPermissions;
}

function jsonOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function renderWithProviders() {
  // ToastProvider is required by useToast(); import lazily to avoid
  // affecting the mocks above.
  const { ToastProvider } = jest.requireActual("@/components/ui/toast");
  return render(
    <ToastProvider>
      <IngestionSourcesView />
    </ToastProvider>,
  );
}

describe("<IngestionSourcesView />", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    mockUseRagPermissions.mockReturnValue({ userInfo: { role: "OPENFGA" } });
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("renders a card per fetched source", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/rag/sources") {
        return jsonOk({ success: true, data: { sources: [makeSource()] } });
      }
      return jsonOk({});
    });

    renderWithProviders();

    await waitFor(() => expect(screen.getByText("example-channel")).toBeInTheDocument());
  });

  it("shows the empty state when there are no sources", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/rag/sources") {
        return jsonOk({ success: true, data: { sources: [] } });
      }
      return jsonOk({});
    });

    renderWithProviders();

    await waitFor(() => expect(screen.getByText(/no ingestion sources yet/i)).toBeInTheDocument());
  });

  it("shows an error banner when the fetch fails", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/rag/sources") {
        return { ok: false, status: 500, statusText: "Internal Error", json: async () => ({}) };
      }
      return jsonOk({});
    });

    renderWithProviders();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("opens the create dialog and POSTs a new source", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/rag/sources" && (!init || init.method === undefined)) {
        return jsonOk({ success: true, data: { sources: [] } });
      }
      if (url === "/api/rag/sources" && init?.method === "POST") {
        return jsonOk({ success: true, data: makeSource() });
      }
      if (url.includes("/api/dynamic-agents/teams")) {
        return jsonOk({ success: true, data: [{ _id: "t1", slug: "team-example", name: "Example Team" }] });
      }
      return jsonOk({});
    });

    renderWithProviders();
    await waitFor(() => expect(screen.getByText(/no ingestion sources yet/i)).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /new source/i }));
    await user.type(screen.getByLabelText(/^name/i), "Example Channel");
    await user.type(screen.getByLabelText(/channel id/i), "C123");
    await user.type(screen.getByTestId("mock-owner-team"), "team-example");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /create source/i }));
    });

    const postCalls = fetchMock.mock.calls.filter(
      ([url, init]) => url === "/api/rag/sources" && init?.method === "POST",
    );
    expect(postCalls).toHaveLength(1);
    const body = JSON.parse(postCalls[0][1].body);
    expect(body).toMatchObject({ name: "Example Channel", channel_id: "C123", owner_team_slug: "team-example" });
  });

  it("deletes a source after confirmation", async () => {
    const user = userEvent.setup();
    let deleted = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/rag/sources") {
        return jsonOk({ success: true, data: { sources: deleted ? [] : [makeSource()] } });
      }
      if (url === "/api/rag/sources/slack-channel-C1" && init?.method === "DELETE") {
        deleted = true;
        return jsonOk({ success: true, data: { deleted: "slack-channel-C1" } });
      }
      return jsonOk({});
    });

    renderWithProviders();
    await waitFor(() => expect(screen.getByText("example-channel")).toBeInTheDocument());

    await user.click(screen.getByTitle("Delete source"));
    await user.click(screen.getByRole("button", { name: /confirm delete example-channel/i }));

    await waitFor(() => expect(screen.getByText(/no ingestion sources yet/i)).toBeInTheDocument());
  });

  it("adopts a config-driven source when the caller is an org admin", async () => {
    mockUseRagPermissions.mockReturnValue({ userInfo: { role: "ADMIN" } });
    const user = userEvent.setup();
    let adopted = false;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/rag/sources") {
        return jsonOk({
          success: true,
          data: {
            sources: [
              makeSource({
                config_driven: true,
                config_import_adopted: adopted,
              }),
            ],
          },
        });
      }
      if (url === "/api/rag/sources/slack-channel-C1/adopt" && init?.method === "POST") {
        adopted = true;
        return jsonOk({ success: true, data: makeSource({ config_driven: true, config_import_adopted: true }) });
      }
      return jsonOk({});
    });

    renderWithProviders();
    await waitFor(() => expect(screen.getByText("Adopt")).toBeInTheDocument());

    await user.click(screen.getByText("Adopt"));

    await waitFor(() => expect(screen.queryByText("Adopt")).not.toBeInTheDocument());
  });
});
