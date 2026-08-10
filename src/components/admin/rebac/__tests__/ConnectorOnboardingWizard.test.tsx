import { fireEvent, render, screen } from "@testing-library/react";

import {
  ConnectorOnboardingWizard,
  type ConnectorOnboardingRow,
} from "../ConnectorOnboardingWizard";

function makeRow(overrides: Partial<ConnectorOnboardingRow>): ConnectorOnboardingRow {
  const name = overrides.name ?? "Space";
  return {
    id: overrides.id ?? name,
    name,
    secondary: overrides.secondary ?? "group",
    selected: overrides.selected ?? false,
    teamSlug: overrides.teamSlug ?? "",
    agentId: overrides.agentId ?? "",
    isExisting: overrides.isExisting ?? false,
    teamRequired: overrides.teamRequired,
    selectable: overrides.selectable,
    importLabel: `Import ${name}`,
    teamLabel: `Team for ${name}`,
    agentLabel: `Dynamic Agent for ${name}`,
  };
}

function renderWizard(rows: ConnectorOnboardingRow[], onApply = jest.fn()) {
  render(
    <ConnectorOnboardingWizard
      itemSingular="space"
      itemPlural="spaces"
      discoveredLabel="space"
      findLabel="Find spaces"
      refreshLabel="Refresh"
      loadingLabel="Loading…"
      emptyLabel="No spaces"
      description="desc"
      discoveryStatusText="status"
      discoveredCount={rows.length}
      configuredCount={rows.filter((r) => r.isExisting).length}
      newCount={rows.length}
      selectedCount={rows.filter((r) => r.selected && r.teamSlug && r.agentId).length}
      rows={rows}
      teams={[{ value: "team-a", label: "Team A" }]}
      agents={[{ value: "agent-a", label: "Agent A" }]}
      error={null}
      disabled={false}
      loading={false}
      discovering={false}
      onDiscover={jest.fn()}
      onSelectAll={jest.fn()}
      onClearSelection={jest.fn()}
      onRowChange={jest.fn()}
      onApply={onApply}
    />,
  );
  return onApply;
}

it("enables Set up for the ready rows and skips blocked rows when both are selected", () => {
  const onApply = renderWizard([
    makeRow({ id: "ready", name: "Ready Space", selected: true, teamSlug: "team-a", agentId: "agent-a" }),
    makeRow({ id: "blocked", name: "Blocked Space", selected: true }),
  ]);

  // Only the one ready row is counted in the button label (not 2 selected).
  const applyButton = screen.getByRole("button", { name: "Set up 1 space" });
  expect(applyButton).toBeEnabled();

  // The admin is told the blocked row will be skipped rather than being blocked.
  expect(screen.getByText("1 space will be skipped (need a team or Dynamic Agent).")).toBeInTheDocument();
  expect(
    screen.queryByText(/need a team or Dynamic Agent before setup/i),
  ).not.toBeInTheDocument();

  fireEvent.click(applyButton);
  expect(onApply).toHaveBeenCalledTimes(1);
});

it("disables Set up only when every selected row is blocked", () => {
  renderWizard([
    makeRow({ id: "b1", name: "Blocked One", selected: true }),
    makeRow({ id: "b2", name: "Blocked Two", selected: true }),
  ]);

  expect(screen.getByRole("button", { name: "Set up 0 spaces" })).toBeDisabled();
  expect(
    screen.getByText("2 spaces need a team or Dynamic Agent before setup."),
  ).toBeInTheDocument();
});

it("disables Set up when nothing is selected", () => {
  renderWizard([
    makeRow({ id: "ready", name: "Ready Space", selected: false, teamSlug: "team-a", agentId: "agent-a" }),
  ]);

  expect(screen.getByRole("button", { name: "Set up 0 spaces" })).toBeDisabled();
  expect(screen.getByText("Select at least one space to set up.")).toBeInTheDocument();
});

it("shows non-team direct rooms as personal DMs instead of team-assigned rows", () => {
  renderWizard([
    makeRow({
      id: "direct",
      name: "Sri Aradhyula",
      secondary: "direct-room · direct",
      selected: true,
      teamSlug: "team-a",
      agentId: "agent-a",
      teamRequired: false,
      selectable: false,
    }),
  ]);

  const checkbox = screen.getByRole("checkbox", { name: "Import Sri Aradhyula" });
  expect(checkbox).toBeDisabled();
  expect(checkbox).not.toBeChecked();
  expect(screen.queryByLabelText("Team for Sri Aradhyula")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Dynamic Agent for Sri Aradhyula")).not.toBeInTheDocument();
  expect(screen.getAllByText("Personal DM")).toHaveLength(2);
  expect(screen.getByText("Direct user routing")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Set up 0 spaces" })).toBeDisabled();
});
