import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { IdentityGroupSyncTab } from "../IdentityGroupSyncTab";

describe("IdentityGroupSyncTab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async (url: string) => {
      if (url === "/api/admin/identity-group-sync/providers") {
        return {
          json: async () => ({ success: true, data: { total: 1 } }),
        } as Response;
      }
      if (url === "/api/admin/identity-group-sync/claim-suggestions") {
        return {
          json: async () => ({
            success: true,
            data: {
              groups: [
                {
                  provider_id: "oidc-claims",
                  external_group_id: "caipe-users",
                  display_name: "caipe-users",
                  normalized_name: "caipe-users",
                  status: "active",
                },
                {
                  provider_id: "oidc-claims",
                  external_group_id: "caipe-admins",
                  display_name: "caipe-admins",
                  normalized_name: "caipe-admins",
                  status: "active",
                },
              ],
              suggestions: [
                {
                  source_group_id: "caipe-users",
                  display_name: "caipe-users",
                  suggested_team_slug: "caipe-users",
                  suggested_team_name: "caipe-users",
                  suggested_relationship: "member",
                  suggested_org_admin: false,
                },
                {
                  source_group_id: "caipe-admins",
                  display_name: "caipe-admins",
                  suggested_team_slug: "caipe-admins",
                  suggested_team_name: "caipe-admins",
                  suggested_relationship: "admin",
                  suggested_org_admin: true,
                },
              ],
              dry_run: {
                matched_groups: [],
                ignored_groups: [],
                teams_to_create: [
                  { slug: "caipe-users", name: "caipe-users", source_group_id: "caipe-users" },
                ],
                membership_sources_to_add: [],
                membership_sources_to_remove: [],
                tuple_writes: [],
                tuple_deletes: [],
                skipped_users: [],
                conflicts: [],
              },
            },
          }),
        } as Response;
      }
      if (url === "/api/admin/identity-group-sync/apply") {
        return {
          json: async () => ({ success: true, data: { run: { status: "applied" } } }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as jest.Mock;
  });

  it("loads and renders team suggestions from the current admin's claim groups", async () => {
    render(<IdentityGroupSyncTab isAdmin />);

    await screen.findByText("1 provider configured");
    fireEvent.click(screen.getByRole("button", { name: /detect my groups/i }));

    const suggestions = await screen.findByRole("region", { name: /detected group to team mappings/i });
    expect(within(suggestions).getAllByText("caipe-users").length).toBeGreaterThan(0);
    expect(within(suggestions).getAllByText("caipe-admins").length).toBeGreaterThan(0);
    expect(within(suggestions).getByText(/grants org-admin/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/admin/identity-group-sync/claim-suggestions");
    });
    expect(screen.getByText("Preview changes")).toBeInTheDocument();
  });

  it("keeps many claim suggestions in a searchable scroll region", async () => {
    render(<IdentityGroupSyncTab isAdmin />);

    await screen.findByText("1 provider configured");
    fireEvent.click(screen.getByRole("button", { name: /detect my groups/i }));

    const suggestions = await screen.findByRole("region", { name: /detected group to team mappings/i });
    expect(suggestions).toHaveClass("max-h-[28rem]", "overflow-y-auto");

    fireEvent.change(screen.getByRole("searchbox", { name: /filter detected groups/i }), {
      target: { value: "admins" },
    });

    expect(within(suggestions).getAllByText("caipe-admins").length).toBeGreaterThan(0);
    expect(within(suggestions).queryByText("caipe-users")).not.toBeInTheDocument();
  });

  it("selects detected groups and applies them as CAIPE teams", async () => {
    render(<IdentityGroupSyncTab isAdmin />);

    await screen.findByText("1 provider configured");
    fireEvent.click(screen.getByRole("button", { name: /detect my groups/i }));

    const suggestions = await screen.findByRole("region", { name: /detected group to team mappings/i });
    fireEvent.click(within(suggestions).getByRole("button", { name: /caipe-users/i }));
    fireEvent.click(screen.getByRole("button", { name: /add 1 selected as caipe team/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/identity-group-sync/apply",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"slug":"caipe-users"'),
        })
      );
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/identity-group-sync/apply",
      expect.objectContaining({
        body: expect.stringContaining('"reviewed":true'),
      })
    );
  });

  it("keeps claim suggestions primary and manual previews tucked away", async () => {
    render(<IdentityGroupSyncTab isAdmin />);

    await screen.findByText("1 provider configured");
    expect(screen.getByText(/Detected groups/i)).toBeInTheDocument();
    expect(screen.queryByText(/Full rule management lands/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/resolved member email/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /manual dry-run/i }));

    expect(screen.getByLabelText(/resolved member email/i)).toBeInTheDocument();
    expect(screen.getByText(/test a specific upstream group/i)).toBeInTheDocument();
  });

  it("runs manual dry-run against backend-enabled rules instead of a hardcoded frontend preview rule", async () => {
    render(<IdentityGroupSyncTab isAdmin />);

    await screen.findByText("1 provider configured");
    fireEvent.click(screen.getByRole("button", { name: /manual dry-run/i }));
    fireEvent.change(screen.getByLabelText(/external group name/i), {
      target: { value: "foo-access" },
    });
    fireEvent.change(screen.getByLabelText(/resolved member email/i), {
      target: { value: "sraradhy@cisco.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /run dry-run/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/identity-group-sync/dry-run",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"provider_id":"oidc-claims"'),
        })
      );
    });

    const dryRunCall = (global.fetch as jest.Mock).mock.calls.find(
      ([url]) => url === "/api/admin/identity-group-sync/dry-run"
    );
    const body = JSON.parse(dryRunCall[1].body);
    expect(body.rules).toBeUndefined();
    expect(body.existing_teams).toBeUndefined();
    expect(body.existing_membership_sources).toBeUndefined();
    expect(body.groups[0]).toEqual(
      expect.objectContaining({
        external_group_id: "foo-access",
        display_name: "foo-access",
        normalized_name: "foo-access",
      })
    );
    expect(body.groups[0].members).toEqual([
      expect.objectContaining({
        email: "sraradhy@cisco.com",
        display_name: "sraradhy@cisco.com",
        active: true,
      }),
    ]);
  });

  it("shows a re-auth notice when session claim groups are not cached", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: string) => {
      if (url === "/api/admin/identity-group-sync/providers") {
        return {
          json: async () => ({ success: true, data: { total: 1 } }),
        } as Response;
      }
      if (url === "/api/admin/identity-group-sync/claim-suggestions") {
        return {
          json: async () => ({
            success: true,
            data: {
              groups: [],
              suggestions: [],
              dry_run: null,
              reason: "missing_session_group_claims",
            },
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(<IdentityGroupSyncTab isAdmin />);

    await screen.findByText("1 provider configured");
    fireEvent.click(screen.getByRole("button", { name: /detect my groups/i }));

    expect(await screen.findByText(/Sign out and sign back in/i)).toBeInTheDocument();
  });
});
