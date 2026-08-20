import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AutoIngestCredentialHealthTab } from "../AutoIngestCredentialHealthTab";

const fetchMock = jest.fn();
global.fetch = fetchMock;

function response(status: "healthy" | "refresh_failed" = "healthy") {
  return {
    ok: true,
    json: async () => ({
      health: {
        generatedAt: "2026-08-13T18:00:00.000Z",
        refreshIntervalMs: 300_000,
        summary: { projects: 1, healthy: status === "healthy" ? 1 : 0, attention: status === "healthy" ? 0 : 1, missing: 0 },
        rows: [
          {
            projectId: "project-id",
            projectSlug: "example-project",
            projectTitle: "Example Project",
            dataSteward: "Example Team",
            dataStewardType: "team",
            credentialOwner: {
              email: "owner@example.test",
              name: "Example Owner",
            },
            provider: "github",
            status,
            lastAttemptAt: "2026-08-13T18:00:00.000Z",
            detail: status === "healthy" ? "Token is available." : "Provider unavailable.",
          },
        ],
      },
    }),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockResolvedValue(response());
});

describe("AutoIngestCredentialHealthTab", () => {
  it("shows the data steward, credential owner, provider, and healthy status", async () => {
    render(<AutoIngestCredentialHealthTab />);

    expect(await screen.findByText("Example Project")).toBeInTheDocument();
    expect(screen.getByText("Example Team")).toBeInTheDocument();
    expect(screen.getByText("Example Owner")).toBeInTheDocument();
    expect(screen.getByText("owner@example.test")).toBeInTheDocument();
    expect(screen.getByText("github")).toBeInTheDocument();
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });

  it("shows provider refresh failures as requiring attention", async () => {
    fetchMock.mockResolvedValue(response("refresh_failed"));

    render(<AutoIngestCredentialHealthTab />);

    expect(await screen.findByText("Refresh failed")).toBeInTheDocument();
    expect(screen.getByText("Provider unavailable.")).toBeInTheDocument();
  });

  it("runs an immediate backend refresh when an admin clicks Refresh now", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(response("refresh_failed"))
      .mockResolvedValueOnce(response("healthy"));
    render(<AutoIngestCredentialHealthTab />);
    await screen.findByText("Refresh failed");

    await user.click(screen.getByRole("button", { name: "Refresh now" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/tome/admin/auto-ingest-credentials",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
    expect(await screen.findByText("Healthy")).toBeInTheDocument();
  });

  it("surfaces API errors without hiding the last known health snapshot", async () => {
    const user = userEvent.setup();
    fetchMock
      .mockResolvedValueOnce(response())
      .mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Refresh unavailable" }) });
    render(<AutoIngestCredentialHealthTab />);
    await screen.findByText("Example Project");

    await user.click(screen.getByRole("button", { name: "Refresh now" }));

    expect(await screen.findByText("Refresh unavailable")).toBeInTheDocument();
    expect(screen.getByText("Example Project")).toBeInTheDocument();
  });
});
