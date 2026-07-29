/**
 * @jest-environment jsdom
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IngestionSourceConfigWithPermissions } from "@/types/ingestion-source";
import { IngestionSourceCard } from "../IngestionSourceCard";

function makeSource(
  overrides: Partial<IngestionSourceConfigWithPermissions> = {},
): IngestionSourceConfigWithPermissions {
  return {
    source_id: "slack-channel-C1",
    source_type: "slack_channel",
    channel_id: "C1",
    name: "example-channel",
    description: "Example source",
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

describe("<IngestionSourceCard />", () => {
  it("renders name, type, status, and visibility badges", () => {
    render(
      <IngestionSourceCard
        source={makeSource()}
        isOrgAdmin={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onAdopt={jest.fn()}
      />,
    );
    expect(screen.getByText("example-channel")).toBeInTheDocument();
    expect(screen.getByText("Slack Channel")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.getByText("team")).toBeInTheDocument();
  });

  it("hides edit/delete controls when the caller cannot manage the source", () => {
    render(
      <IngestionSourceCard
        source={makeSource({ _permissions: { can_manage: false } })}
        isOrgAdmin={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onAdopt={jest.fn()}
      />,
    );
    expect(screen.queryByTitle("Edit")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Delete source")).not.toBeInTheDocument();
  });

  it("shows edit/delete controls when the caller can manage the source", () => {
    render(
      <IngestionSourceCard
        source={makeSource()}
        isOrgAdmin={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onAdopt={jest.fn()}
      />,
    );
    expect(screen.getByTitle("Edit")).toBeInTheDocument();
    expect(screen.getByTitle("Delete source")).toBeInTheDocument();
  });

  it("requires a confirm click before calling onDelete", async () => {
    const user = userEvent.setup();
    const onDelete = jest.fn().mockResolvedValue(undefined);
    render(
      <IngestionSourceCard
        source={makeSource()}
        isOrgAdmin={false}
        onEdit={jest.fn()}
        onDelete={onDelete}
        onAdopt={jest.fn()}
      />,
    );

    await user.click(screen.getByTitle("Delete source"));
    expect(onDelete).not.toHaveBeenCalled();

    const confirmBtn = screen.getByRole("button", { name: /confirm delete example-channel/i });
    await user.click(confirmBtn);
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  });

  it("shows Adopt only for org admins viewing a config-driven, not-yet-adopted source", () => {
    const { rerender } = render(
      <IngestionSourceCard
        source={makeSource({ config_driven: true, config_import_adopted: false })}
        isOrgAdmin={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onAdopt={jest.fn()}
      />,
    );
    expect(screen.queryByText("Adopt")).not.toBeInTheDocument();

    rerender(
      <IngestionSourceCard
        source={makeSource({ config_driven: true, config_import_adopted: false })}
        isOrgAdmin={true}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onAdopt={jest.fn()}
      />,
    );
    expect(screen.getByText("Adopt")).toBeInTheDocument();

    rerender(
      <IngestionSourceCard
        source={makeSource({ config_driven: true, config_import_adopted: true })}
        isOrgAdmin={true}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onAdopt={jest.fn()}
      />,
    );
    expect(screen.queryByText("Adopt")).not.toBeInTheDocument();
  });

  it("calls onAdopt when Adopt is clicked", async () => {
    const user = userEvent.setup();
    const onAdopt = jest.fn().mockResolvedValue(undefined);
    render(
      <IngestionSourceCard
        source={makeSource({ config_driven: true, config_import_adopted: false })}
        isOrgAdmin={true}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onAdopt={onAdopt}
      />,
    );
    await user.click(screen.getByText("Adopt"));
    await waitFor(() => expect(onAdopt).toHaveBeenCalledTimes(1));
  });

  it("renders the config-driven badge", () => {
    render(
      <IngestionSourceCard
        source={makeSource({ config_driven: true })}
        isOrgAdmin={false}
        onEdit={jest.fn()}
        onDelete={jest.fn()}
        onAdopt={jest.fn()}
      />,
    );
    expect(screen.getByText("Config")).toBeInTheDocument();
  });
});
