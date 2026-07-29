/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IngestionSourceConfig } from "@/types/ingestion-source";

// TeamOwnershipFields pulls in team pickers/popovers; stub to a minimal
// control surface, mirroring KbSharingPanel.transfer.test.tsx's approach.
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

import { IngestionSourceForm } from "../IngestionSourceForm";

function jsonOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

beforeEach(() => {
  global.fetch = jest.fn().mockImplementation(async (url: string) => {
    if (url.includes("/api/dynamic-agents/teams")) {
      return jsonOk({ success: true, data: [{ _id: "t1", slug: "team-example", name: "Example Team" }] });
    }
    return jsonOk({});
  }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("<IngestionSourceForm /> — create", () => {
  it("disables Create until name, identity fields, and owner team are filled", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<IngestionSourceForm open onClose={jest.fn()} onSave={onSave} initial={null} />);

    const createBtn = screen.getByRole("button", { name: /create source/i });
    expect(createBtn).toBeDisabled();

    await user.type(screen.getByLabelText(/^name/i), "Example Channel");
    expect(createBtn).toBeDisabled();

    await user.type(screen.getByLabelText(/channel id/i), "C123");
    expect(createBtn).toBeDisabled();

    await user.type(screen.getByTestId("mock-owner-team"), "team-example");
    await waitFor(() => expect(createBtn).not.toBeDisabled());
  });

  it("submits a slack_channel payload with identity fields and owner_team_slug on create", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<IngestionSourceForm open onClose={jest.fn()} onSave={onSave} initial={null} />);

    await user.type(screen.getByLabelText(/^name/i), "Example Channel");
    await user.type(screen.getByLabelText(/channel id/i), "C123");
    await user.type(screen.getByTestId("mock-owner-team"), "team-example");

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /create source/i }));
    });

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        source_type: "slack_channel",
        name: "Example Channel",
        channel_id: "C123",
        owner_team_slug: "team-example",
      }),
    );
  });

  it("switches identity fields when source_type changes", async () => {
    const user = userEvent.setup();
    render(<IngestionSourceForm open onClose={jest.fn()} onSave={jest.fn()} initial={null} />);

    expect(screen.getByLabelText(/channel id/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/source type/i), "web_url");
    expect(screen.queryByLabelText(/channel id/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/^url/i)).toBeInTheDocument();
  });
});

describe("<IngestionSourceForm /> — edit", () => {
  const initial: IngestionSourceConfig = {
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
  };

  it("disables the source_type selector and identity fields", () => {
    render(<IngestionSourceForm open onClose={jest.fn()} onSave={jest.fn()} initial={initial} />);
    expect(screen.getByLabelText(/source type/i)).toBeDisabled();
    expect(screen.getByLabelText(/channel id/i)).toBeDisabled();
  });

  it("never renders a visibility control", () => {
    render(<IngestionSourceForm open onClose={jest.fn()} onSave={jest.fn()} initial={initial} />);
    expect(screen.queryByLabelText(/visibility/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^global$/i)).not.toBeInTheDocument();
  });

  it("submits only mutable fields on save (no identity/source_type)", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(<IngestionSourceForm open onClose={jest.fn()} onSave={onSave} initial={initial} />);

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const payload = onSave.mock.calls[0][0];
    expect(payload).not.toHaveProperty("source_type");
    expect(payload).not.toHaveProperty("channel_id");
    expect(payload).not.toHaveProperty("source_id");
  });
});
