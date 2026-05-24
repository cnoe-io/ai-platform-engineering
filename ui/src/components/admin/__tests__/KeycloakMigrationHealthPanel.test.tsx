import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { KeycloakMigrationHealthPanel } from "../KeycloakMigrationHealthPanel";

// Mock the Tooltip primitive so its content always renders inline in the
// test DOM (the real component portals into document.body on hover with
// a delay, which is awkward and racy under JSDOM). This mirrors the mock
// in `ui/src/components/layout/__tests__/AppHeader.test.tsx`.
jest.mock("@/components/ui/tooltip", () => {
  const TooltipTrigger = React.forwardRef(function MockTooltipTrigger(
    { children, asChild }: { children: React.ReactNode; asChild?: boolean },
    ref: React.Ref<HTMLElement>,
  ) {
    if (asChild && React.isValidElement(children)) {
      return children;
    }
    return (
      <span ref={ref as React.Ref<HTMLSpanElement>}>{children}</span>
    );
  });
  return {
    Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipContent: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="mock-tooltip-content">{children}</div>
    ),
    TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    TooltipTrigger,
  };
});

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
    bootstrap_admins: {
      enabled: true,
      configured_emails: ["admin@cisco.com"],
      resolved_count: 1,
      created_count: 0,
      failed_count: 0,
      tuple_write_count: 3,
      warnings: [],
      outcomes: [
        {
          email: "admin@cisco.com",
          user_id: "sub-admin",
          status: "existing",
          tuple_write_count: 3,
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

    fireEvent.click(screen.getByRole("button", { name: /Reconcile all/i }));

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

  // The "applied_counts tile grid" was removed in 2026-05-24 — those
  // tiles (Mongo teams seen / Team scopes reconciled / OBO permission
  // sets reconciled / Bot service accounts reconciled / Token exchange
  // permissions reconciled / Active team defaults selected / Bootstrap
  // admin {resolved,placeholders,tuples,failures}) showed raw last-run
  // counters from the reconciliation algorithm, which are bookkeeping
  // noise once Keycloak is steady. The Invariants section below the
  // grid is now the single source of truth for "is Keycloak healthy",
  // with its own per-row Fix buttons. Raw counts are still persisted on
  // the migration record and exposed via the JSON API for anyone
  // debugging the migration itself.
  it("does not render the applied_counts tile grid for any reconciliation count", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(failedHealth));

    render(<KeycloakMigrationHealthPanel />);

    // Wait for the panel to render before asserting absence so we don't
    // race the initial fetch.
    expect(await screen.findByText("Keycloak Reconciliation Health")).toBeInTheDocument();

    // None of the previously-rendered counter tile labels should exist.
    // Each was a Metric tile with an "Inspect <label> metric" button —
    // those buttons are also gone now, so the inspect-values modal is
    // unreachable via the panel UI.
    const removedLabels = [
      "Mongo teams seen",
      "Team scopes reconciled",
      "OBO permission sets reconciled",
      "Bot service accounts reconciled",
      "Token exchange permissions reconciled",
      "Active team defaults selected",
    ];
    for (const label of removedLabels) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: new RegExp(`Inspect ${label} metric`, "i") }),
      ).not.toBeInTheDocument();
    }
    // The Inspect-values modal entry point is also gone — the modal
    // root itself should not be open at this point.
    expect(screen.queryByText("Keycloak values")).not.toBeInTheDocument();
  });

  it("renders bootstrap admin reconciliation diagnostics", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(completedHealth));

    render(<KeycloakMigrationHealthPanel />);

    expect(await screen.findByText("Bootstrap admins")).toBeInTheDocument();
    expect(screen.getByText("1/1 resolved")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Inspect Bootstrap admins metric/i }));

    expect(await screen.findByRole("dialog", { name: /Bootstrap admins details/i })).toBeInTheDocument();
    expect(screen.getByText("admin@cisco.com")).toBeInTheDocument();
    expect(screen.getByText("sub-admin")).toBeInTheDocument();
  });

  it("renders Keycloak invariants with pass/fail pills and remediation hints", async () => {
    // Hydrate a `completedHealth` fixture with a mixed-status invariants block
    // so we can assert the panel renders pass + fail groups, shows the
    // top-level summary pill, and surfaces the Reconcile now CTA when any
    // failing invariant is remediation=reconcile_now.
    const healthWithInvariants = {
      success: true,
      data: {
        ...completedHealth.data,
        keycloak_invariants: {
          summary: {
            total: 3,
            passing: 1,
            failing: 1,
            unknown: 1,
            reconcile_now_recommended: true,
          },
          items: [
            {
              id: "obo.users_impersonate.affirmative",
              description: "users.impersonate scope-permission uses AFFIRMATIVE strategy",
              group: "obo",
              source: "init-idp.sh",
              status: "fail",
              detail: "Current strategy: UNANIMOUS.",
              remediation: "reconcile_now",
            },
            {
              id: "obo.users_impersonate.policies_strict",
              description: "users.impersonate perm only has strict client allow-list policies",
              group: "obo",
              source: "init-idp.sh",
              status: "pass",
              remediation: "none",
            },
            {
              id: "team_scope.team-platform.active_team_mapper",
              description: "team-platform has an active_team protocol mapper",
              group: "team-scope",
              source: "bff-migration",
              status: "unknown",
              detail: "Could not read the mapper.",
              remediation: "reconcile_now",
            },
          ],
        },
      },
    };

    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(healthWithInvariants));

    render(<KeycloakMigrationHealthPanel />);

    // Section renders
    expect(await screen.findByTestId("keycloak-invariants")).toBeInTheDocument();

    // Top-row summary pill counts the failures
    expect(screen.getByText("1 invariant failing")).toBeInTheDocument();

    // The failing OBO row is visible (initial-open behavior on fail/unknown
    // groups), shows the inline Fix action, and renders its detail copy so
    // admins can read the remediation hint without expanding anything.
    const failingRow = await screen.findByTestId(
      "invariant-obo.users_impersonate.affirmative",
    );
    expect(failingRow).toHaveTextContent("AFFIRMATIVE strategy");
    expect(failingRow).toHaveTextContent("Fail");
    expect(failingRow).toHaveTextContent("Current strategy: UNANIMOUS.");
    // Per-row "Fix" button is present for reconcile_now invariants.
    expect(
      screen.getByTestId("invariant-fix-obo.users_impersonate.affirmative"),
    ).toHaveTextContent(/Fix/);

    // The unknown team-scope row is rendered inside the team-scope
    // matrix view (not the flat list), with its status carried on
    // the StatusDot's data-status attribute. The matrix table itself
    // is gated behind the accordion header being open, which the
    // panel does automatically for any group containing a non-pass
    // invariant.
    const unknownDot = await screen.findByTestId(
      "team-scope-status-dot-team_scope.team-platform.active_team_mapper",
    );
    expect(unknownDot.getAttribute("data-status")).toBe("unknown");

    // Reconcile-all CTA at the top of the card is visible because at least
    // one failing invariant has remediation=reconcile_now even though the
    // existing schema/migration state is healthy.
    expect(screen.getByRole("button", { name: /Reconcile all/i })).toBeInTheDocument();
  });

  // ─────────────────────────────────────────────────────────────
  // Plain-English invariant tooltip explainer.
  //
  // The cryptic machine IDs (`obo.token_exchange.shared_audience.affirmative`,
  // `team_scope.team-platform.active_team_mapper`) are accurate but not
  // self-explanatory. Each row now renders a HelpCircle affordance with a
  // hover tooltip decoded by `explainInvariant`. These assertions verify
  // (a) the affordance is present for EVERY row regardless of status,
  // (b) the tooltip body is decoded (not the raw ID), and
  // (c) the aria-label embeds the decoded title so screen readers and
  //     keyboard users get the same information without the hover.
  // ─────────────────────────────────────────────────────────────
  it("renders a plain-English explainer tooltip for every invariant row regardless of status", async () => {
    const healthWithMixedInvariants = {
      success: true,
      data: {
        ...completedHealth.data,
        keycloak_invariants: {
          summary: {
            total: 3,
            passing: 1,
            failing: 1,
            unknown: 1,
            reconcile_now_recommended: true,
          },
          items: [
            {
              id: "obo.token_exchange.shared_audience.affirmative",
              description: "caipe-platform token-exchange perm uses AFFIRMATIVE strategy",
              group: "obo",
              source: "init-idp.sh",
              status: "pass",
              remediation: "none",
            },
            {
              id: "obo.users_impersonate.exists",
              description: "Realm users.impersonate scope-permission exists",
              group: "obo",
              source: "init-idp.sh",
              status: "fail",
              detail: "Permission missing.",
              remediation: "reconcile_now",
            },
            {
              id: "team_personal.dm_mode_known_limitation",
              description: "team-personal DM mode has a known token-exchange limitation",
              group: "team-scope",
              source: "init-token-exchange.sh",
              status: "unknown",
              detail: "RFC 8693 drops the scope= parameter; see architecture docs.",
              remediation: "manual_keycloak",
            },
          ],
        },
      },
    };

    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(healthWithMixedInvariants));

    render(<KeycloakMigrationHealthPanel />);

    // (a) Affordance present for every row, including the passing one
    // (so users can hover *any* row to learn what it checks). The
    // OBO group still renders as a flat accordion, so its rows keep
    // the `invariant-explain-…` testids; the team-scope group now
    // renders as the matrix view, so the dm_mode_known_limitation
    // advisory is hoisted to the matrix's top-level advisory row
    // with its own testid (`team-scope-advisory-explain`).
    expect(
      await screen.findByTestId("invariant-explain-obo.token_exchange.shared_audience.affirmative"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("invariant-explain-obo.users_impersonate.exists"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("team-scope-advisory-explain"),
    ).toBeInTheDocument();

    // (b) Tooltip body is the decoded explanation, not the raw ID. With
    // the mock that always renders TooltipContent, we can read the body
    // text directly. The passing AFFIRMATIVE row must explain WHY
    // AFFIRMATIVE is needed (not just repeat the description).
    const affirmativeRow = screen.getByTestId(
      "invariant-obo.token_exchange.shared_audience.affirmative",
    );
    expect(affirmativeRow.textContent ?? "").toMatch(/UNANIMOUS/);
    expect(affirmativeRow.textContent ?? "").toMatch(/both bot client-allowlist policies/i);

    // The failing users.impersonate row must reference the realm-wide
    // impersonation gate in plain English. The "keep both technical
    // and plain-English" wording style means the body now embeds the
    // technical client-id (`users.impersonate`) inline with the
    // `realm-level scope-permission` phrase, so we accept either
    // ordering.
    const existsRow = screen.getByTestId("invariant-obo.users_impersonate.exists");
    expect(existsRow.textContent ?? "").toMatch(
      /realm-level (?:`users\.impersonate` )?scope-permission/i,
    );
    expect(existsRow.textContent ?? "").toMatch(/no client.*can ever issue an OBO.*token/i);

    // The advisory DM-mode row now lives in the team-scope matrix's
    // top-level advisory bar (not in the flat invariant list). The
    // tooltip body — decoded from `invariant-explanations.ts` — must
    // still surface the RFC 8693 explanation, and the BFF's raw
    // `detail` is rendered inline underneath so admins can read the
    // multi-sentence prose without hovering.
    const dmAdvisory = screen.getByTestId("team-scope-advisory");
    expect(dmAdvisory.textContent ?? "").toMatch(/DM-mode marker (?:client )?scope/i);
    expect(dmAdvisory.textContent ?? "").toMatch(/architecture\.md/);

    // (c) The hover affordance's aria-label embeds the decoded title so
    // screen-reader users get the same context without firing a hover.
    const affordance = screen.getByTestId(
      "invariant-explain-obo.token_exchange.shared_audience.affirmative",
    );
    const ariaLabel = affordance.getAttribute("aria-label") ?? "";
    expect(ariaLabel).toContain("caipe-platform token-exchange perm uses AFFIRMATIVE strategy");
    // The decoder's title is appended after the row description, so an
    // assistive technology user can hear both the "what" and the "why".
    expect(ariaLabel).toMatch(/AFFIRMATIVE decision strategy/);
  });

  it("fixes a single failing invariant by reusing the global migration endpoint", async () => {
    // A per-row "Fix" click should POST to the same migration apply endpoint
    // as the top-level "Reconcile all" button. The button is just an
    // ergonomic affordance to indicate which row prompted the run; the BFF
    // contract is unchanged.
    const healthWithFailingInvariant = {
      success: true,
      data: {
        ...completedHealth.data,
        keycloak_invariants: {
          summary: {
            total: 1,
            passing: 0,
            failing: 1,
            unknown: 0,
            reconcile_now_recommended: true,
          },
          items: [
            {
              id: "team_scope.team-personal.optional_on_webex_bot",
              description: "team-personal bound optional on caipe-webex-bot",
              group: "team-scope",
              source: "init-idp.sh",
              status: "fail",
              detail: "Scope not listed in the Webex bot's optional client scopes.",
              remediation: "reconcile_now",
            },
          ],
        },
      },
    };

    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(healthWithFailingInvariant))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { applied_counts: { team_scopes_reconciled: 1 } },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(completedHealth));

    render(<KeycloakMigrationHealthPanel />);

    // With the team-scope matrix in place, the per-row Fix testid is
    // gone; the equivalent at this layer is the per-team Fix button
    // on the row (`team-scope-team-fix-<slug>`). Clicking it drives
    // the same global reconcile migration as the old per-invariant
    // Fix, just with a different originId for the spinner indicator.
    fireEvent.click(
      await screen.findByTestId("team-scope-team-fix-team-personal"),
    );

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
  });

  it("offers a Copy diagnostics button that writes the full health payload", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      configurable: true,
    });

    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(completedHealth));

    render(<KeycloakMigrationHealthPanel />);

    fireEvent.click(
      await screen.findByRole("button", {
        name: /Copy full Keycloak diagnostics JSON/i,
      }),
    );

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('"realm": "caipe"');
    expect(copied).toContain('"manifest_status": "completed"');
  });

  it("marks health degraded when bootstrap admin reconciliation has failures", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        ...completedHealth.data,
        bootstrap_admins: {
          ...completedHealth.data.bootstrap_admins,
          resolved_count: 0,
          failed_count: 1,
          tuple_write_count: 0,
          warnings: ["admin@cisco.com: OpenFGA is not configured"],
          outcomes: [
            {
              email: "admin@cisco.com",
              user_id: "sub-admin",
              status: "failed",
              tuple_write_count: 0,
              error: "OpenFGA is not configured",
            },
          ],
        },
      },
    }));

    render(<KeycloakMigrationHealthPanel />);

    expect(await screen.findByText("Bootstrap admin failures")).toHaveClass("text-amber-700");
    expect(screen.getByText("0/1 resolved")).toBeInTheDocument();
  });

  // ─────────────────────────────────────────────────────────────
  // Plain-English explainer tooltips for migration warnings and
  // bootstrap admin failures.
  //
  // These tests guard the two pieces of UX added in response to
  // admin feedback that the raw warning text ("Skipped active_team
  // default selection because KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG is
  // unset…", "Bootstrap admin reconciliation failed for 1 email(s)")
  // is technically accurate but means nothing to an admin who has
  // not been living inside the RBAC system.
  //
  // The wiring lives on:
  //   - Every row in the migration "Warnings" bar gets a HelpCircle
  //     affordance with a decoded title / body / fix tooltip.
  //   - The "Bootstrap admin reconciliation failed for N email(s)"
  //     header gets a HelpCircle that explains the *concept* of
  //     bootstrap admin reconciliation, separate from any specific
  //     failing email.
  //   - Each failed-email row inside the bootstrap bar also gets
  //     its own HelpCircle that explains common failure causes
  //     (typo, OpenFGA unreachable, profile policy too strict,
  //     email casing).
  // ─────────────────────────────────────────────────────────────
  it("renders a plain-English explainer tooltip on every migration warning row", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        ...completedHealth.data,
        migration: {
          ...completedHealth.data.migration,
          last_run: {
            ...completedHealth.data.migration.last_run,
            warnings: [
              "Skipped active_team default selection because KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG is unset and there is not exactly one Mongo team.",
              "Some brand new warning we haven't taught the decoder yet",
            ],
          },
        },
      },
    }));

    render(<KeycloakMigrationHealthPanel />);

    // The raw warning text is still rendered verbatim — admins can
    // copy it, screen readers read it, the explainer just augments.
    await waitFor(() =>
      expect(
        screen.getByText(/KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG is unset/i),
      ).toBeInTheDocument(),
    );

    // Row 0: the known active_team_slug_unset warning should have
    // an explainer affordance with the decoded title + body + fix.
    const knownRow = screen.getByTestId("migration-warning-row-0");
    expect(knownRow).toHaveTextContent(/KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG is unset/i);
    const knownTrigger = screen.getByTestId("migration-warning-explain-0");
    expect(knownTrigger).toBeInTheDocument();
    expect(knownTrigger.getAttribute("aria-label") ?? "").toMatch(
      /Explain warning:.*KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG/,
    );
    // Tooltip body (rendered inline by the mock) must contain
    // both the technical name AND a plain-English gloss for it,
    // PLUS a "How to fix:" block with a concrete example.
    const knownTooltip = knownTrigger.closest("[data-testid='migration-warning-row-0']");
    expect(knownTooltip?.textContent ?? "").toMatch(/caipe-platform/);
    expect(knownTooltip?.textContent ?? "").toMatch(/active_team/);
    expect(knownTooltip?.textContent ?? "").toMatch(/on-behalf-of/i);
    expect(knownTooltip?.textContent ?? "").toMatch(/How to fix:/);
    expect(knownTooltip?.textContent ?? "").toMatch(/KEYCLOAK_RBAC_ACTIVE_TEAM_SLUG=platform/);

    // Row 1: even an unknown warning must still get an explainer
    // trigger (with the generic fallback body) — the panel must
    // never silently swallow the row.
    const unknownTrigger = screen.getByTestId("migration-warning-explain-1");
    expect(unknownTrigger).toBeInTheDocument();
    expect(unknownTrigger.getAttribute("aria-label") ?? "").toMatch(/Migration warning/);
  });

  it("renders a section-level explainer on the Bootstrap admin header and a per-row explainer for each failed email", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        ...completedHealth.data,
        bootstrap_admins: {
          ...completedHealth.data.bootstrap_admins,
          resolved_count: 0,
          failed_count: 2,
          tuple_write_count: 0,
          warnings: [
            "alice@example.com: user not found in Keycloak realm `caipe`",
            "bob@example.com: OpenFGA returned 502",
          ],
          outcomes: [
            {
              email: "alice@example.com",
              status: "failed",
              tuple_write_count: 0,
              error: "user not found in Keycloak realm `caipe`",
            },
            {
              email: "bob@example.com",
              status: "failed",
              tuple_write_count: 0,
              error: "OpenFGA returned 502",
            },
          ],
        },
      },
    }));

    render(<KeycloakMigrationHealthPanel />);

    // The amber header row must show the count AND a section-level
    // "?" affordance for the concept-of-bootstrap-admins explainer.
    await waitFor(() =>
      expect(
        screen.getByText(/Bootstrap admin reconciliation failed for 2 emails/i),
      ).toBeInTheDocument(),
    );
    const headerTrigger = screen.getByTestId("bootstrap-admin-header-explain");
    expect(headerTrigger).toBeInTheDocument();
    // Header tooltip explains the concept (not per-email) and
    // names both env-var variants and the OpenFGA dependency.
    const headerTooltipText =
      headerTrigger.parentElement?.textContent ?? "";
    expect(headerTooltipText).toMatch(/BOOTSTRAP_ADMIN_EMAILS/);
    expect(headerTooltipText).toMatch(/RBAC_BOOTSTRAP_ADMIN_EMAILS/);
    expect(headerTooltipText).toMatch(/empty Keycloak realm|locked out/i);

    // Each failed-email row gets its own per-row explainer with
    // the email interpolated into the title and the error into
    // the body.
    const row0 = screen.getByTestId("bootstrap-admin-warning-row-0");
    expect(row0).toHaveTextContent(/alice@example\.com:/);
    expect(row0).toHaveTextContent(/user not found in Keycloak realm/);
    const explain0 = screen.getByTestId("bootstrap-admin-warning-explain-0");
    expect(explain0.getAttribute("aria-label") ?? "").toMatch(/alice@example\.com/);

    const row1 = screen.getByTestId("bootstrap-admin-warning-row-1");
    expect(row1).toHaveTextContent(/bob@example\.com:/);
    expect(row1).toHaveTextContent(/OpenFGA returned 502/);
    const explain1 = screen.getByTestId("bootstrap-admin-warning-explain-1");
    expect(explain1.getAttribute("aria-label") ?? "").toMatch(/bob@example\.com/);

    // Per-row tooltip body must include the "How to fix" block
    // with at least a typo / policy / OpenFGA / casing hint.
    const row1Text = row1.textContent ?? "";
    expect(row1Text).toMatch(/How to fix:/);
    expect(row1Text).toMatch(/typo/i);
    expect(row1Text).toMatch(/KEYCLOAK_USER_PROFILE_UNMANAGED_ATTRIBUTE_POLICY/);
  });

  // ─────────────────────────────────────────────────────────────
  // Team-scope matrix at scale.
  //
  // These tests pin the contract for the matrix that replaced the
  // flat list. Every realm size now renders the matrix (no
  // threshold), so we exercise:
  //
  //   - 100 teams render as 100 rows in a single table,
  //   - the slug search and "failing only" toggle narrow the
  //     visible rows without touching the underlying matrix counts,
  //   - the per-failure-kind chip filter does what it says,
  //   - the per-team and per-kind Fix buttons both POST to the
  //     same global reconcile endpoint,
  //   - team-personal renders 3 cells and an "N/A" marker in the
  //     audience column (no failure noise from a structurally
  //     missing cell), and
  //   - the dm_mode_known_limitation advisory is hoisted to its
  //     own row above the matrix (not stuck inside the table).
  //
  // Helper: build the migration-health fixture for N teams with an
  // optional set of failing-kind injections. The matrix is always
  // rendered as the team-scope group's body.
  // ─────────────────────────────────────────────────────────────
  function makeMatrixFixture({
    teamSlugs,
    failingCells = [],
    includePersonalTeam = true,
    includeDmAdvisory = true,
  }: {
    teamSlugs: string[];
    failingCells?: Array<{ slug: string; kind: string }>;
    includePersonalTeam?: boolean;
    includeDmAdvisory?: boolean;
  }) {
    const kinds = [
      "active_team_mapper",
      "optional_on_slack_bot",
      "optional_on_webex_bot",
      "default_on_obo_audience",
    ];
    const items: Array<Record<string, unknown>> = [];
    const isFailing = (slug: string, kind: string) =>
      failingCells.some((f) => f.slug === slug && f.kind === kind);
    for (const slug of teamSlugs) {
      for (const kind of kinds) {
        items.push({
          id: `team_scope.team-${slug}.${kind}`,
          description: `team-${slug} ${kind}`,
          group: "team-scope",
          source: "bff-migration",
          status: isFailing(slug, kind) ? "fail" : "pass",
          remediation: isFailing(slug, kind) ? "reconcile_now" : "none",
        });
      }
    }
    if (includePersonalTeam) {
      for (const kind of kinds.filter((k) => k !== "default_on_obo_audience")) {
        items.push({
          id: `team_scope.team-personal.${kind}`,
          description: `team-personal ${kind}`,
          group: "team-scope",
          source: "init-token-exchange.sh",
          status: "pass",
          remediation: "none",
        });
      }
    }
    if (includeDmAdvisory) {
      items.push({
        id: "team_personal.dm_mode_known_limitation",
        description: "team-personal DM mode has a known token-exchange limitation",
        group: "team-scope",
        source: "init-token-exchange.sh",
        status: "unknown",
        detail: "RFC 8693 drops the scope= parameter; see architecture.md for the rationale.",
        remediation: "manual_keycloak",
      });
    }
    const failing = items.filter((i) => i.status === "fail").length;
    const unknown = items.filter((i) => i.status === "unknown").length;
    return {
      success: true,
      data: {
        ...completedHealth.data,
        keycloak_invariants: {
          summary: {
            total: items.length,
            passing: items.length - failing - unknown,
            failing,
            unknown,
            reconcile_now_recommended: failing > 0,
          },
          items,
        },
      },
    };
  }

  it("renders one row per team in the matrix table at 100 teams (no flat list, no virtualization)", async () => {
    const teamSlugs = Array.from({ length: 100 }, (_, i) => `t${i.toString().padStart(3, "0")}`);
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(
      makeMatrixFixture({
        teamSlugs,
        failingCells: [{ slug: "t017", kind: "optional_on_slack_bot" }],
      }),
    ));

    render(<KeycloakMigrationHealthPanel />);

    // Matrix container is rendered (not the old flat ul of 400+ <li>s).
    await waitFor(() => expect(screen.getByTestId("team-scope-matrix")).toBeInTheDocument());

    // One row per real team (100 customer teams + 1 personal team).
    expect(screen.getByTestId("team-scope-row-team-t017")).toBeInTheDocument();
    expect(screen.getByTestId("team-scope-row-team-t000")).toBeInTheDocument();
    expect(screen.getByTestId("team-scope-row-team-t099")).toBeInTheDocument();
    expect(screen.getByTestId("team-scope-row-team-personal")).toBeInTheDocument();

    // Each row carries one StatusDot per kind (4 for normal teams,
    // 3 for team-personal which structurally omits the audience cell).
    for (const kind of [
      "active_team_mapper",
      "optional_on_slack_bot",
      "optional_on_webex_bot",
      "default_on_obo_audience",
    ]) {
      expect(
        screen.getByTestId(`team-scope-cell-team-t000-${kind}`),
      ).toBeInTheDocument();
    }
    expect(
      screen.getByTestId("team-scope-cell-team-personal-active_team_mapper"),
    ).toBeInTheDocument();
    // team-personal's audience cell renders the N/A marker, not a dot.
    const personalAudienceCell = screen.getByTestId(
      "team-scope-cell-team-personal-default_on_obo_audience",
    );
    expect(personalAudienceCell.textContent ?? "").toMatch(/N\/A/);

    // The failing row sorts above the passing rows.
    const tableHtml = screen.getByTestId("team-scope-matrix-table").innerHTML;
    expect(tableHtml.indexOf("team-scope-row-team-t017")).toBeLessThan(
      tableHtml.indexOf("team-scope-row-team-t000"),
    );
  });

  it("narrows the visible rows when the slug search and 'failing only' toggle are used (counts unchanged)", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(
      makeMatrixFixture({
        teamSlugs: ["alpha", "beta", "gamma"],
        failingCells: [{ slug: "alpha", kind: "optional_on_slack_bot" }],
      }),
    ));

    render(<KeycloakMigrationHealthPanel />);

    await waitFor(() => expect(screen.getByTestId("team-scope-matrix")).toBeInTheDocument());

    // All four rows visible at first (alpha, beta, gamma, personal).
    expect(screen.getByTestId("team-scope-row-team-alpha")).toBeInTheDocument();
    expect(screen.getByTestId("team-scope-row-team-beta")).toBeInTheDocument();
    expect(screen.getByTestId("team-scope-row-team-gamma")).toBeInTheDocument();
    expect(screen.getByTestId("team-scope-row-team-personal")).toBeInTheDocument();

    // Slug search narrows the visible rows.
    fireEvent.change(screen.getByTestId("team-scope-slug-search"), {
      target: { value: "alph" },
    });
    expect(screen.getByTestId("team-scope-row-team-alpha")).toBeInTheDocument();
    expect(screen.queryByTestId("team-scope-row-team-beta")).not.toBeInTheDocument();
    expect(screen.queryByTestId("team-scope-row-team-gamma")).not.toBeInTheDocument();

    // Clear the search and exercise the "failing only" toggle.
    fireEvent.change(screen.getByTestId("team-scope-slug-search"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByTestId("team-scope-failing-only"));
    expect(screen.getByTestId("team-scope-row-team-alpha")).toBeInTheDocument();
    expect(screen.queryByTestId("team-scope-row-team-beta")).not.toBeInTheDocument();
    expect(screen.queryByTestId("team-scope-row-team-gamma")).not.toBeInTheDocument();
    expect(screen.queryByTestId("team-scope-row-team-personal")).not.toBeInTheDocument();
  });

  it("filters by per-kind failure chip and disables chips with no issues", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(
      makeMatrixFixture({
        teamSlugs: ["a", "b"],
        failingCells: [
          { slug: "a", kind: "optional_on_slack_bot" },
          { slug: "b", kind: "optional_on_webex_bot" },
        ],
      }),
    ));

    render(<KeycloakMigrationHealthPanel />);

    await waitFor(() => expect(screen.getByTestId("team-scope-matrix")).toBeInTheDocument());

    // Slack chip is active (has 1 issue), webex chip too. Mapper and
    // audience chips show no issues and are disabled.
    const slackChip = screen.getByTestId("team-scope-kind-chip-optional_on_slack_bot");
    const webexChip = screen.getByTestId("team-scope-kind-chip-optional_on_webex_bot");
    const mapperChip = screen.getByTestId("team-scope-kind-chip-active_team_mapper");
    expect(slackChip).not.toBeDisabled();
    expect(webexChip).not.toBeDisabled();
    expect(mapperChip).toBeDisabled();

    // Clicking the Slack chip narrows to team-a only.
    fireEvent.click(slackChip);
    expect(screen.getByTestId("team-scope-row-team-a")).toBeInTheDocument();
    expect(screen.queryByTestId("team-scope-row-team-b")).not.toBeInTheDocument();
  });

  it("clicking the per-team Fix button POSTs to the global reconcile endpoint", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(
        makeMatrixFixture({
          teamSlugs: ["needs-fix"],
          failingCells: [{ slug: "needs-fix", kind: "optional_on_slack_bot" }],
        }),
      ))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { applied_counts: { team_scopes_reconciled: 1 } },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(completedHealth));

    render(<KeycloakMigrationHealthPanel />);

    fireEvent.click(
      await screen.findByTestId("team-scope-team-fix-team-needs-fix"),
    );

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
  });

  it("clicking the per-kind Fix button POSTs to the same global reconcile endpoint", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(
        makeMatrixFixture({
          teamSlugs: ["a", "b"],
          failingCells: [
            { slug: "a", kind: "optional_on_slack_bot" },
            { slug: "b", kind: "optional_on_slack_bot" },
          ],
        }),
      ))
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: { applied_counts: { team_scopes_reconciled: 2 } },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(completedHealth));

    render(<KeycloakMigrationHealthPanel />);

    fireEvent.click(
      await screen.findByTestId("team-scope-kind-fix-optional_on_slack_bot"),
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/rebac/migrations/keycloak_rbac_mapping_reconciliation_v1/apply",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("hoists the team_personal.dm_mode_known_limitation advisory to its own row above the matrix", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(
      makeMatrixFixture({
        teamSlugs: ["a"],
        failingCells: [],
        includeDmAdvisory: true,
      }),
    ));

    render(<KeycloakMigrationHealthPanel />);

    // The advisory bar renders with its own testid, distinct from
    // any matrix row, and includes the BFF's multi-sentence detail
    // inline so admins can read the RFC 8693 explanation without
    // hovering anything.
    const advisory = await screen.findByTestId("team-scope-advisory");
    expect(advisory).toHaveTextContent(/known token-exchange limitation/i);
    expect(advisory).toHaveTextContent(/RFC 8693/);
    // The advisory's explainer affordance is present (same hover
    // contract as every other invariant), and the row is marked
    // "Manual" because there's no remediation we can apply.
    expect(screen.getByTestId("team-scope-advisory-explain")).toBeInTheDocument();
    expect(advisory).toHaveTextContent(/Manual/);

    // Sanity: the advisory must NOT appear as a matrix cell.
    expect(
      screen.queryByTestId("team-scope-cell-team-personal-dm_mode_known_limitation"),
    ).not.toBeInTheDocument();
  });

  it("expanding a team row reveals the four per-cell invariants with the existing plain-English explainer tooltips", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(
      makeMatrixFixture({
        teamSlugs: ["alpha"],
        failingCells: [{ slug: "alpha", kind: "active_team_mapper" }],
      }),
    ));

    render(<KeycloakMigrationHealthPanel />);

    await waitFor(() => expect(screen.getByTestId("team-scope-row-team-alpha")).toBeInTheDocument());

    // Toggle the row open.
    fireEvent.click(screen.getByTestId("team-scope-row-toggle-team-alpha"));

    // The detail row is rendered.
    expect(
      screen.getByTestId("team-scope-row-detail-team-alpha"),
    ).toBeInTheDocument();

    // Each per-cell invariant carries a HelpCircle explain affordance
    // wired to `invariant-explanations.ts`, AND for failing cells with
    // remediation=reconcile_now there's an inline per-cell Fix
    // affordance (clicking it POSTs to the same global endpoint).
    expect(
      screen.getByTestId(
        "team-scope-expanded-explain-team_scope.team-alpha.active_team_mapper",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "team-scope-expanded-fix-team_scope.team-alpha.active_team_mapper",
      ),
    ).toBeInTheDocument();
  });

  // ─────────────────────────────────────────────────────────────
  // Targeted heal for the `audience.<client>.single_team_default`
  // invariant. The panel renders a dedicated picker + button only
  // when the invariant is failing; clicking it calls the new
  // `/api/admin/keycloak/active-team-scope` route with the typed
  // slug, then refreshes the health fixture.
  // ─────────────────────────────────────────────────────────────
  function fixtureWithAudienceCardinalityFailing(defaults: string[]) {
    return {
      success: true,
      data: {
        ...completedHealth.data,
        keycloak_values: {
          ...completedHealth.data.keycloak_values,
          active_team_defaults: [
            { audience_client_id: "caipe-platform", default_team_scopes: defaults },
          ],
        },
        keycloak_invariants: {
          summary: {
            total: 1,
            passing: 0,
            failing: 1,
            unknown: 0,
            reconcile_now_recommended: true,
          },
          items: [
            {
              id: "audience.caipe-platform.single_team_default",
              description: "caipe-platform has at most one real team-* default scope",
              group: "team-scope",
              source: "bff-migration",
              status: "fail",
              remediation: "reconcile_now",
              detail: `Audience client \`caipe-platform\` currently has multiple real team-* scopes bound as default: \`${defaults.join("`, `")}\`.`,
            },
          ],
        },
      },
    };
  }

  it("does NOT render the active-team-scope heal action when the invariant is passing (no failing items)", async () => {
    const passingFixture = {
      success: true,
      data: {
        ...completedHealth.data,
        keycloak_invariants: {
          summary: {
            total: 1,
            passing: 1,
            failing: 0,
            unknown: 0,
            reconcile_now_recommended: false,
          },
          items: [
            {
              id: "audience.caipe-platform.single_team_default",
              description: "caipe-platform has at most one real team-* default scope",
              group: "team-scope",
              source: "bff-migration",
              status: "pass",
              remediation: "none",
            },
          ],
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValueOnce(jsonResponse(passingFixture));

    render(<KeycloakMigrationHealthPanel />);

    await screen.findByText("Keycloak Reconciliation Health");
    expect(screen.queryByTestId("active-team-scope-action")).not.toBeInTheDocument();
    expect(screen.queryByTestId("active-team-scope-slug-input")).not.toBeInTheDocument();
  });

  it("renders the active-team-scope heal action with the current team-* defaults when the invariant fails", async () => {
    global.fetch = jest.fn().mockResolvedValueOnce(
      jsonResponse(
        fixtureWithAudienceCardinalityFailing(["team-platform", "team-eti-sre-admin"]),
      ),
    );

    render(<KeycloakMigrationHealthPanel />);

    await screen.findByText("Keycloak Reconciliation Health");
    const action = await screen.findByTestId("active-team-scope-action");
    // Both current defaults must be displayed so the admin can see
    // what's currently bound and pick which one to pin.
    expect(action).toHaveTextContent("team-platform");
    expect(action).toHaveTextContent("team-eti-sre-admin");
    expect(action).toHaveTextContent("caipe-platform");
    // The slug input is empty by default; the apply button is
    // disabled until the admin types something.
    const input = screen.getByTestId("active-team-scope-slug-input") as HTMLInputElement;
    expect(input.value).toBe("");
    const apply = screen.getByTestId("active-team-scope-apply") as HTMLButtonElement;
    expect(apply).toBeDisabled();
  });

  it("POSTs the lowercased slug to the new route, shows success, and refreshes health", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          fixtureWithAudienceCardinalityFailing(["team-platform", "team-eti-sre-admin"]),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            active_team_slug: "platform",
            audience_client_id: "caipe-platform",
          },
        }),
      )
      // Refresh after the heal — invariant now passes (we don't have
      // to model the exact passing fixture, the action surface
      // disappearing on the next render is enough).
      .mockResolvedValueOnce(
        jsonResponse(fixtureWithAudienceCardinalityFailing(["team-platform"])),
      );

    render(<KeycloakMigrationHealthPanel />);

    const input = (await screen.findByTestId(
      "active-team-scope-slug-input",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Platform" } });
    fireEvent.click(screen.getByTestId("active-team-scope-apply"));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/keycloak/active-team-scope",
        expect.objectContaining({
          method: "POST",
          // Slug is lowercased before sending so case-insensitive
          // human input still produces the canonical slug Keycloak
          // expects.
          body: JSON.stringify({ team_slug: "platform" }),
        }),
      );
    });
    // Inline success message rendered with the result; the route's
    // response is shown verbatim so the admin can see exactly what
    // got changed.
    expect(await screen.findByTestId("active-team-scope-success")).toHaveTextContent(
      /pinned to platform/i,
    );
  });

  it("surfaces a backend error inline without losing the typed slug", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(
          fixtureWithAudienceCardinalityFailing(["team-platform", "team-eti-sre-admin"]),
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: 'Invalid team slug "bad!" — must be lowercase alphanumerics with hyphens',
          },
          false,
          400,
        ),
      );

    render(<KeycloakMigrationHealthPanel />);

    const input = (await screen.findByTestId(
      "active-team-scope-slug-input",
    )) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "bad!" } });
    fireEvent.click(screen.getByTestId("active-team-scope-apply"));

    // The error toast / banner uses the same error pipeline as the
    // rest of the panel, so it surfaces inline near the top.
    expect(await screen.findByText(/Invalid team slug/i)).toBeInTheDocument();
    // The slug input retains the typed value so the admin can fix
    // the typo without re-typing.
    expect(input.value).toBe("bad!");
  });
});
