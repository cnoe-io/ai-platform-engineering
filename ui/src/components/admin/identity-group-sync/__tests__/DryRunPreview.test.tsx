import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

import { DryRunPreview } from "../DryRunPreview";
import type { ExternalGroup, IdentityGroupSyncDryRunResult } from "@/types/identity-group-sync";

const emptyResult: IdentityGroupSyncDryRunResult = {
  matched_groups: [],
  ignored_groups: [],
  teams_to_create: [],
  membership_sources_to_add: [],
  membership_sources_to_remove: [],
  tuple_writes: [],
  tuple_deletes: [],
  skipped_users: [],
  conflicts: [],
};

describe("DryRunPreview", () => {
  it("shows a quiet empty state and hides apply when there are no changes", () => {
    render(<DryRunPreview result={emptyResult} applying={false} onApply={jest.fn()} />);

    expect(screen.getByText("No sync changes to apply")).toBeInTheDocument();
    expect(screen.getByText(/The detected groups did not produce team, membership, or tuple changes/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply reviewed sync/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Teams to create")).not.toBeInTheDocument();
  });

  it("explains detected groups that are already represented or unmatched when no changes are needed", () => {
    const detectedGroups: ExternalGroup[] = [
      {
        provider_id: "oidc-claims",
        external_group_id: "backstage-access",
        display_name: "backstage-access",
        normalized_name: "backstage-access",
        status: "active",
      },
      {
        provider_id: "oidc-claims",
        external_group_id: "foo-access",
        display_name: "foo-access",
        normalized_name: "foo-access",
        status: "active",
      },
    ];

    render(
      <DryRunPreview
        result={{
          ...emptyResult,
          matched_groups: [detectedGroups[0]],
          ignored_groups: [detectedGroups[1]],
        }}
        detectedGroups={detectedGroups}
        applying={false}
        onApply={jest.fn()}
      />
    );

    expect(screen.getByText("Detected groups are already represented")).toBeInTheDocument();
    expect(screen.getByText("detected")).toBeInTheDocument();
    expect(screen.getByText("already represented")).toBeInTheDocument();
    expect(screen.getByText("unmatched")).toBeInTheDocument();
    expect(screen.getAllByText("backstage-access").length).toBeGreaterThan(0);
    expect(screen.getByText("Already represented")).toBeInTheDocument();
    expect(screen.getAllByText("foo-access").length).toBeGreaterThan(0);
    expect(screen.getByText("No enabled sync rule matched")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply reviewed sync/i })).not.toBeInTheDocument();
  });

  it("requires acknowledgement before applying risky member removals", () => {
    const onApply = jest.fn();
    render(
      <DryRunPreview
        result={{
          ...emptyResult,
          membership_sources_to_remove: [
            {
              team_id: "platform-id",
              team_slug: "platform",
              user_subject: "admin-sub",
              user_email: "admin@example.test",
              relationship: "admin",
              source_type: "oidc_claim",
              provider_id: "oidc-claims",
              external_group_id: "caipe-admins",
              sync_rule_id: "rule-admin",
              managed: true,
              status: "removed",
              created_at: "2026-05-12T00:00:00.000Z",
            },
          ],
          tuple_deletes: [{ user: "user:admin-sub", relation: "admin", object: "team:platform" }],
          safety_warnings: [
            {
              code: "admin_membership_removal",
              severity: "blocker",
              message: "Admin membership for admin@example.test on team platform would be removed.",
              requires_acknowledgement: true,
              team_slug: "platform",
              user_identifier: "admin@example.test",
            },
          ],
        }}
        applying={false}
        onApply={onApply}
      />
    );

    expect(screen.getByText(/Admin membership for admin@example.test/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /apply reviewed sync/i })).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /acknowledge removal risks/i }));
    fireEvent.click(screen.getByRole("button", { name: /apply reviewed sync/i }));

    expect(onApply).toHaveBeenCalledWith({ acknowledgeRemovalRisks: true });
  });
});
