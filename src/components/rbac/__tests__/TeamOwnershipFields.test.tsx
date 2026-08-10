/**
 * Tests for the shared <TeamOwnershipFields> control bundle
 * (spec 2026-06-03-unified-shareable-resource-rbac, US1 contract ui-component.md).
 *
 * Pins the behavior every host editor relies on: owner picker disabled on edit
 * (unless transfers are allowed), share multi-select toggles, creator shown
 * read-only, and (US3) the not-a-member transfer confirmation gates onTransfer.
 * assisted-by Codex Codex-sonnet-4-6
 */

import * as React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

import { TeamOwnershipFields } from "@/components/rbac/TeamOwnershipFields";
import { pickTeam } from "@/__test-utils__/team-picker";

const TEAMS = [
  { slug: "platform", name: "Platform" },
  { slug: "data-eng", name: "Data Eng" },
  { slug: "sre", name: "SRE" },
];

function setup(overrides: Partial<React.ComponentProps<typeof TeamOwnershipFields>> = {}) {
  const onOwnerTeamChange = jest.fn();
  const onSharedTeamsChange = jest.fn();
  const onTransfer = jest.fn();
  render(
    <TeamOwnershipFields
      ownerTeamSlug={overrides.ownerTeamSlug ?? "platform"}
      sharedTeamSlugs={overrides.sharedTeamSlugs ?? []}
      isEditing={overrides.isEditing ?? false}
      availableTeams={TEAMS}
      currentUserTeamSlugs={overrides.currentUserTeamSlugs ?? ["platform", "data-eng"]}
      onOwnerTeamChange={onOwnerTeamChange}
      onSharedTeamsChange={onSharedTeamsChange}
      onTransfer={onTransfer}
      resourceNoun="data source"
      {...overrides}
    />,
  );
  return { onOwnerTeamChange, onSharedTeamsChange, onTransfer };
}

describe("TeamOwnershipFields", () => {
  it("renders the owner picker enabled on create", () => {
    setup({ isEditing: false });
    expect(screen.getByLabelText(/Owner Team/i)).not.toBeDisabled();
  });

  it("disables the owner picker on edit", () => {
    setup({ isEditing: true });
    expect(screen.getByLabelText(/Owner Team/i)).toBeDisabled();
  });

  it("keeps the owner picker editable on edit when transfers are allowed", () => {
    setup({ isEditing: true, allowTransfer: true });
    expect(screen.getByLabelText(/Owner Team/i)).not.toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /Transfer ownership/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Changing the owner team will transfer ownership when you save/i),
    ).toBeInTheDocument();
  });

  it("shows the creator subject read-only when present", () => {
    setup({ creatorSubject: "alice-sub" });
    expect(screen.getByTestId("creator-subject")).toHaveTextContent("alice-sub");
  });

  it("requires the not-a-member confirmation before transferring", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
    const { onTransfer } = setup({
      isEditing: true,
      allowTransfer: true,
      ownerTeamSlug: "platform",
      currentUserTeamSlugs: ["platform"], // NOT a member of sre
    });
    // The picker is directly editable; attempt to transfer to sre (not a
    // member) → confirm returns false → no call.
    await pickTeam(/Owner Team/i, "sre");
    expect(confirmSpy).toHaveBeenCalled();
    expect(onTransfer).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("calls onTransfer(slug, true) once the not-a-member transfer is confirmed", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const { onTransfer, onOwnerTeamChange } = setup({
      isEditing: true,
      allowTransfer: true,
      ownerTeamSlug: "platform",
      currentUserTeamSlugs: ["platform"],
    });
    await pickTeam(/Owner Team/i, "sre");
    expect(onOwnerTeamChange).toHaveBeenCalledWith("sre");
    expect(onTransfer).toHaveBeenCalledWith("sre", true);
    confirmSpy.mockRestore();
  });

  it("hides the share section when showShare is false", () => {
    setup({ showShare: false });
    expect(screen.queryByText(/Share with Teams/i)).not.toBeInTheDocument();
  });

  it("shows the share section when showShare is true", () => {
    setup({ showShare: true });
    expect(screen.getByText(/Share with Teams/i)).toBeInTheDocument();
  });

  it("renders betweenOwnerAndShare slot content", () => {
    setup({ betweenOwnerAndShare: <div data-testid="vis-toggle">visibility</div> });
    expect(screen.getByTestId("vis-toggle")).toBeInTheDocument();
  });
});
