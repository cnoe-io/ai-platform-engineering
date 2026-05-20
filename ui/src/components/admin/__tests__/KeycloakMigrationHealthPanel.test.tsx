import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { KeycloakMigrationHealthPanel } from "../KeycloakMigrationHealthPanel";

function jsonResponse(payload: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

const failedHealth = {
  success: true,
  data: {
    keycloak: {
      configured: true,
      reachable: false,
      realm: "caipe",
      last_probe_at: "2026-05-19T12:00:00.000Z",
      probe_error: "Keycloak unavailable",
    },
    schema_area: {
      area: "keycloak_rbac_mappings",
      current_version: 0,
      target_version: 1,
      status: "behind",
      last_migration_id: "keycloak_rbac_mapping_reconciliation_v1",
    },
    migration: {
      id: "keycloak_rbac_mapping_reconciliation_v1",
      manifest_status: "failed",
      last_run: {
        status: "failed",
        actor: "webui-startup",
        updated_at: "2026-05-19T12:00:00.000Z",
        applied_counts: { team_scopes_reconciled: 2, token_exchange_permissions_reconciled: 1 },
        planned_counts: {},
        warnings: ["Keycloak unavailable"],
        error: "Keycloak unavailable",
      },
    },
    blocking: {
      is_blocking: true,
      blocking_required_count: 1,
    },
    keycloak_values: {
      team_scopes: [
        {
          scope: "team-platform",
          active_team: "platform",
          optional_on_slack_bot: true,
          optional_on_webex_bot: true,
          default_on_obo_audience: true,
        },
      ],
      obo_permissions: [
        {
          bot_client_id: "caipe-slack-bot",
          policy_name: "caipe-slack-bot-token-exchange",
          bot_token_exchange_attached: true,
          users_impersonate_attached: true,
          target_audience_attached: true,
        },
      ],
      bot_service_accounts: [
        {
          client_id: "caipe-slack-bot",
          service_account_id: "sa-slack",
          impersonation_role_assigned: true,
        },
      ],
      token_exchange_permissions: [
        {
          client_id: "caipe-platform",
          decision_strategy: "AFFIRMATIVE",
          token_exchange_permission_id: "perm-1",
          policy_names: [
            "caipe-webex-bot-token-exchange",
            "caipe-slack-bot-token-exchange",
          ],
        },
      ],
      active_team_defaults: [
        {
          audience_client_id: "caipe-platform",
          default_team_scopes: ["team-platform"],
        },
      ],
    },
  },
};

const completedHealth = {
  success: true,
  data: {
    ...failedHealth.data,
    keycloak: {
      ...failedHealth.data.keycloak,
      reachable: true,
      probe_error: undefined,
    },
    schema_area: {
      ...failedHealth.data.schema_area,
      current_version: 1,
      status: "current",
    },
    migration: {
      ...failedHealth.data.migration,
      manifest_status: "completed",
      last_run: {
        ...failedHealth.data.migration.last_run,
        status: "completed",
        error: undefined,
        warnings: [],
      },
    },
    blocking: {
      is_blocking: false,
      blocking_required_count: 0,
    },
  },
};

describe("KeycloakMigrationHealthPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lets admins reconcile a failed Keycloak migration and refreshes health", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(failedHealth))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        data: {
          applied_counts: { team_scopes_reconciled: 2, obo_permission_sets_reconciled: 2 },
        },
      }))
      .mockResolvedValueOnce(jsonResponse(completedHealth));

    render(<KeycloakMigrationHealthPanel />);

    expect(await screen.findByText("Keycloak Reconciliation Health")).toBeInTheDocument();
    expect((await screen.findAllByText("Keycloak unavailable")).length).toBeGreaterThan(0);
    expect(screen.getByText("Keycloak URL configured")).toHaveClass("text-emerald-700");
    expect(screen.getByText("Keycloak unreachable")).toHaveClass("text-red-700");
    expect(screen.getByText("Schema behind")).toHaveClass("text-amber-700");
    expect(screen.getByText("v0 -> v1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Reconcile now/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/rebac/migrations/keycloak_rbac_mapping_reconciliation_v1/apply",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ confirmation: "MIGRATE keycloak_rbac_mappings TO v1" }),
        }),
      );
    });
    expect(await screen.findByText(/Reconcile applied/i)).toBeInTheDocument();
    expect(screen.getByText("Keycloak reachable")).toHaveClass("text-emerald-700");
    expect(screen.getByText("Schema current")).toHaveClass("text-emerald-700");
  });

  it("opens a scrollable Keycloak values modal when a metric tile is clicked", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(failedHealth));

    render(<KeycloakMigrationHealthPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /Inspect Team scopes reconciled metric/i }));

    expect(await screen.findByRole("dialog", { name: /Team scopes reconciled details/i })).toBeInTheDocument();
    expect(screen.getByText("Keycloak values")).toBeInTheDocument();
    expect(screen.getByText("team-platform")).toBeInTheDocument();
    expect(screen.getByText("platform")).toBeInTheDocument();
    expect(screen.queryByText("Metric payload")).not.toBeInTheDocument();
  });

  it("renders Keycloak diagnostic values with readable labels and chips", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(failedHealth));

    render(<KeycloakMigrationHealthPanel />);

    fireEvent.click(
      await screen.findByRole("button", { name: /Inspect Token exchange permissions reconciled metric/i }),
    );

    expect(await screen.findByRole("dialog", { name: /Token exchange permissions reconciled details/i })).toBeInTheDocument();
    expect(screen.getByText("Token exchange permission ID")).toBeInTheDocument();
    expect(screen.getByText("Decision strategy")).toBeInTheDocument();
    expect(screen.getByText("Policy names")).toBeInTheDocument();
    expect(screen.getByText("caipe-webex-bot-token-exchange")).toBeInTheDocument();
    expect(screen.getByText("caipe-slack-bot-token-exchange")).toBeInTheDocument();
    expect(screen.queryByText("token_exchange_permission_id")).not.toBeInTheDocument();
  });

  it("keeps wide Keycloak values inside a scrollable modal without a wide table", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(failedHealth));

    render(<KeycloakMigrationHealthPanel />);

    fireEvent.click(await screen.findByRole("button", { name: /Inspect Team scopes reconciled metric/i }));

    const dialog = await screen.findByRole("dialog", { name: /Team scopes reconciled details/i });
    const scrollRegion = screen.getByTestId("keycloak-values-scroll");

    expect(dialog).toHaveClass("overflow-hidden");
    expect(scrollRegion).toHaveClass("overflow-auto");
    expect(scrollRegion.querySelector("table")).not.toBeInTheDocument();
    expect(screen.getByText("Result 1")).toBeInTheDocument();
  });
});
