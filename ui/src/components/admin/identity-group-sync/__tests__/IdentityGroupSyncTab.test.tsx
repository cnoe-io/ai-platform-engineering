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
    fireEvent.click(screen.getByRole("button", { name: /suggest from my groups/i }));

    const suggestions = await screen.findByRole("region", { name: /claim group suggestions/i });
    expect(within(suggestions).getByText("caipe-users")).toBeInTheDocument();
    expect(within(suggestions).getByText("caipe-admins")).toBeInTheDocument();
    expect(within(suggestions).getByText(/org admin grant review/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/admin/identity-group-sync/claim-suggestions");
    });
    expect(screen.getByText("Dry-run preview")).toBeInTheDocument();
  });

  it("keeps many claim suggestions in a searchable scroll region", async () => {
    render(<IdentityGroupSyncTab isAdmin />);

    await screen.findByText("1 provider configured");
    fireEvent.click(screen.getByRole("button", { name: /suggest from my groups/i }));

    const suggestions = await screen.findByRole("region", { name: /claim group suggestions/i });
    expect(suggestions).toHaveClass("max-h-[28rem]", "overflow-y-auto");

    fireEvent.change(screen.getByRole("searchbox", { name: /filter detected groups/i }), {
      target: { value: "admins" },
    });

    expect(within(suggestions).getByText("caipe-admins")).toBeInTheDocument();
    expect(within(suggestions).queryByText("caipe-users")).not.toBeInTheDocument();
  });

  it("selects detected groups and applies them as CAIPE teams", async () => {
    render(<IdentityGroupSyncTab isAdmin />);

    await screen.findByText("1 provider configured");
    fireEvent.click(screen.getByRole("button", { name: /suggest from my groups/i }));

    const suggestions = await screen.findByRole("region", { name: /claim group suggestions/i });
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
    expect(screen.getByText("Review detected groups")).toBeInTheDocument();
    expect(screen.queryByText(/Full rule management lands/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/resolved member email/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /manual dry-run/i }));

    expect(screen.getByLabelText(/resolved member email/i)).toBeInTheDocument();
    expect(screen.getByText(/test a specific upstream group/i)).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /suggest from my groups/i }));

    expect(await screen.findByText(/Sign out and sign back in/i)).toBeInTheDocument();
  });
});
