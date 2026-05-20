import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { MigrationTab } from "../MigrationTab";

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

describe("MigrationTab", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      if (href === "/api/admin/rebac/migrations") {
        return jsonResponse({
          success: true,
          data: {
            release: "0.5.1",
            runtime: { migration_release: "0.5.1", manifest_count: 6 },
            schema_versions: [
              { schema_area: "conversations", current_version: 1, target_version: 2, status: "behind" },
              { schema_area: "team_resources", current_version: 1, target_version: 2, status: "behind" },
            ],
            migrations: [
              {
                id: "conversation_owner_identity_v1",
                title: "Conversation owner identity v2",
                description: "Normalize conversations",
                kind: "implicit",
                schema_area: "conversations",
                current_version: 1,
                target_version: 2,
                status: "not_started",
                implemented: true,
                confirmation: "MIGRATE conversations TO v2",
                required: true,
              },
              {
                id: "universal_rebac_relationship_backfill_v1",
                title: "Universal ReBAC team resources",
                description: "Expose existing grants",
                kind: "explicit",
                schema_area: "team_resources",
                current_version: 1,
                target_version: 2,
                status: "not_started",
                implemented: true,
                confirmation: "MIGRATE team_resources TO v2",
                required: true,
              },
              {
                id: "slack_channel_rebac_backfill_v1",
                title: "Slack channel ReBAC grants",
                description: "Backfill Slack channel grants",
                kind: "explicit",
                schema_area: "slack_channel_rebac",
                current_version: 1,
                target_version: 2,
                status: "not_started",
                implemented: true,
                confirmation: "MIGRATE slack_channel_rebac TO v2",
                required: true,
              },
              {
                id: "webex_space_rebac_backfill_v1",
                title: "Webex space ReBAC grants",
                description: "Backfill Webex space grants",
                kind: "explicit",
                schema_area: "webex_space_rebac",
                current_version: 1,
                target_version: 2,
                status: "not_started",
                implemented: true,
                confirmation: "MIGRATE webex_space_rebac TO v2",
                required: true,
              },
              {
                id: "messaging_team_mapping_reconciliation_v1",
                title: "Messaging team mapping reconciliation",
                description: "Repair denormalized messaging team assignments",
                kind: "explicit",
                schema_area: "messaging_team_mappings",
                current_version: 1,
                target_version: 2,
                status: "not_started",
                implemented: true,
                confirmation: "MIGRATE messaging_team_mappings TO v2",
                required: true,
              },
              {
                id: "messaging_rebac_indexes_v1",
                title: "Messaging ReBAC indexes",
                description: "Create messaging lookup indexes",
                kind: "index",
                schema_area: "messaging_rebac_indexes",
                current_version: 1,
                target_version: 2,
                status: "not_started",
                implemented: true,
                confirmation: "MIGRATE messaging_rebac_indexes TO v2",
                required: true,
              },
            ],
            completed_migrations: [],
          },
        });
      }
      if (href === "/api/admin/rebac/migrations/status") {
        return jsonResponse({
          success: true,
          data: {
            release: "0.5.1",
            runtime: { migration_release: "0.5.1", manifest_count: 6 },
            schema_versions: [
              { schema_area: "conversations", current_version: 1, target_version: 2, status: "behind" },
            ],
            pending_required_count: 6,
            blocking_required_count: 6,
            is_blocking: true,
            override_active: false,
          },
        });
      }
      if (href === "/api/admin/rebac/migrations/override") {
        return jsonResponse({
          success: true,
          data: {
            release: "0.5.1",
            runtime: { migration_release: "0.5.1", manifest_count: 6 },
            schema_versions: [],
            pending_required_count: 6,
            blocking_required_count: 6,
            is_blocking: false,
            override_active: true,
            override_reason: "Emergency production verification",
          },
        });
      }
      if (href.endsWith("/plan")) {
        const migrationId = href.split("/").at(-2);
        return jsonResponse({
          success: true,
          data: {
            migration_id: migrationId,
            confirmation:
              migrationId === "universal_rebac_relationship_backfill_v1"
                ? "MIGRATE team_resources TO v2"
                : "MIGRATE conversations TO v2",
            counts: {
              total_conversations: 12,
              resolvable: 10,
              unresolved: 2,
              tuple_writes_planned: 0,
            },
            warnings: ["2 conversation owner email(s) could not be resolved to Keycloak subjects."],
            sample_diffs: [
              {
                collection: "conversations",
                id: "c1",
                before: { owner_id: "alice@example.com", owner_subject: null },
                after: { owner_id: "alice@example.com", owner_subject: "alice-sub", owner_identity_version: 2 },
              },
            ],
          },
        });
      }
      if (href.endsWith("/apply")) {
        const body = JSON.parse(String(init?.body ?? "{}"));
        return jsonResponse({
          success: true,
          data: {
            applied_counts: { conversations_updated: body.confirmation ? 10 : 0, tuple_writes_applied: 0 },
          },
        });
      }
      return jsonResponse({ success: false }, false, 404);
    }) as jest.Mock;
  });

  it("loads release migrations and previews a dry run", async () => {
    render(<MigrationTab isAdmin />);

    expect(await screen.findByText("0.5.1 Schema Migrations")).toBeInTheDocument();
    expect(await screen.findByText(/Runtime migration release/i)).toBeInTheDocument();
    expect(await screen.findByText("conversations")).toBeInTheDocument();
    const conversationsCard = screen.getByText("conversations").parentElement;
    expect(conversationsCard).not.toHaveClass("bg-amber-50");
    expect(conversationsCard).not.toHaveClass("bg-emerald-50");
    expect(conversationsCard?.querySelector("svg")).toHaveClass("text-amber-600");
    expect(screen.getAllByText(/v1 -> v2/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("behind")[0]).toHaveClass("text-amber-700");
    expect((await screen.findAllByText("Conversation owner identity v2")).length).toBeGreaterThan(0);
    expect(screen.getByText("Slack channel ReBAC grants")).toBeInTheDocument();
    expect(screen.getByText("Webex space ReBAC grants")).toBeInTheDocument();
    expect(screen.getByText("Messaging team mapping reconciliation")).toBeInTheDocument();
    expect(screen.getByText("Messaging ReBAC indexes")).toBeInTheDocument();
    expect(screen.queryByText("Keycloak Reconciliation Health")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Dry run/i })[0]);

    expect(await screen.findByText("total_conversations")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText(/tuple_writes_planned/i)).toBeInTheDocument();
    expect(screen.getByText("MIGRATE conversations TO v2")).toBeInTheDocument();
  });

  it("allows registered migrations to be selected and dry-run", async () => {
    render(<MigrationTab isAdmin />);

    fireEvent.click(await screen.findByText("Universal ReBAC team resources"));
    expect(screen.getByText("Selected migration:")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Dry run/i })[1]);

    expect(await screen.findByText("MIGRATE team_resources TO v2")).toBeInTheDocument();
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/rebac/migrations/universal_rebac_relationship_backfill_v1/plan",
        { method: "POST" },
      );
    });
  });

  it("requires the typed confirmation before applying", async () => {
    render(<MigrationTab isAdmin />);

    fireEvent.click((await screen.findAllByRole("button", { name: /Dry run/i }))[0]);
    await screen.findByText("MIGRATE conversations TO v2");

    expect(screen.getByRole("button", { name: /^Apply$/i })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Type confirmation/i), {
      target: { value: "MIGRATE conversations TO v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Apply$/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/rebac/migrations/conversation_owner_identity_v1/apply",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ confirmation: "MIGRATE conversations TO v2" }),
        }),
      );
    });
    expect(await screen.findByText(/conversations_updated: 10/i)).toBeInTheDocument();
  });

  it("copies the required confirmation text", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<MigrationTab isAdmin />);

    fireEvent.click((await screen.findAllByRole("button", { name: /Dry run/i }))[0]);
    await screen.findByText("MIGRATE conversations TO v2");

    fireEvent.click(screen.getByRole("button", { name: /Copy confirmation text/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("MIGRATE conversations TO v2");
    });
    expect(
      await screen.findByRole("button", { name: /Copied confirmation text/i }),
    ).toBeInTheDocument();
  });

  it("refreshes the migration manifest in-page", async () => {
    render(<MigrationTab isAdmin />);

    expect((await screen.findAllByText("Conversation owner identity v2")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Refresh migrations/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/admin/rebac/migrations");
      expect((global.fetch as jest.Mock).mock.calls.filter(([url]) => String(url) === "/api/admin/rebac/migrations")).toHaveLength(2);
    });
  });

  it("hides completed migrations by default and reveals them on request", async () => {
    (global.fetch as jest.Mock).mockImplementation(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/admin/rebac/migrations") {
        return jsonResponse({
          success: true,
          data: {
            release: "0.5.1",
            runtime: { migration_release: "0.5.1", manifest_count: 1 },
            schema_versions: [
              { schema_area: "conversations", current_version: 2, target_version: 2, status: "current" },
            ],
            migrations: [],
            completed_migrations: [
              {
                id: "conversation_owner_identity_v1",
                title: "Conversation owner identity v2",
                description: "Normalize conversations",
                kind: "implicit",
                schema_area: "conversations",
                current_version: 2,
                target_version: 2,
                status: "completed",
                implemented: true,
                confirmation: "MIGRATE conversations TO v2",
                required: true,
              },
            ],
          },
        });
      }
      if (String(url) === "/api/admin/rebac/migrations/status") {
        return jsonResponse({
          success: true,
          data: {
            release: "0.5.1",
            runtime: { migration_release: "0.5.1", manifest_count: 1 },
            schema_versions: [],
            pending_required_count: 0,
            blocking_required_count: 0,
            is_blocking: false,
            override_active: false,
          },
        });
      }
      return jsonResponse({ success: false }, false, 404);
    });

    render(<MigrationTab isAdmin />);

    expect(await screen.findByText(/No active migrations/i)).toBeInTheDocument();
    expect(screen.queryByText("Conversation owner identity v2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Show completed migrations/i));

    const completeCheckbox = await screen.findByRole("checkbox", { name: /Migration complete/i });
    expect(completeCheckbox).toBeChecked();
    expect(screen.getAllByText("Conversation owner identity v2").length).toBeGreaterThan(0);
    expect(screen.getByText(/Migration complete/i)).toBeInTheDocument();
    expect(screen.getByText(/v2 -> v2/i)).toBeInTheDocument();
    expect(screen.getByText("current")).toHaveClass("text-emerald-700");
  });

  it("does not render the redundant in-tab migration override warning", async () => {
    render(<MigrationTab isAdmin />);

    expect((await screen.findAllByText(/Conversation owner identity v2/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Migration required before using this version/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Override reason/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Record super-admin override/i })).not.toBeInTheDocument();
  });

  it("does not allow read-only users to run migrations", async () => {
    render(<MigrationTab isAdmin={false} />);

    expect(await screen.findByText(/Admin access required/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
