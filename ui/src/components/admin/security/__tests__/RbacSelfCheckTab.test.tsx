// assisted-by Codex Codex-sonnet-4-6

import { fireEvent,render,screen,waitFor,within } from "@testing-library/react";

import type { RbacSelfCheckReport,RbacSelfCheckTestReport } from "@/types/rbac-self-check";

import { RbacSelfCheckTab } from "../RbacSelfCheckTab";

const fetchMock = jest.fn();

jest.mock("@/components/ui/caipe-spinner", () => ({
  CAIPESpinner: ({ message }: { message: string }) => <div data-testid="spinner">{message}</div>,
}));

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function report(overrides: Partial<RbacSelfCheckReport> = {}): RbacSelfCheckReport {
  const base: RbacSelfCheckReport = {
    generated_at: "2026-06-27T16:00:00.000Z",
    status: "fail",
    inventory: {
      mongo: {
        teams: 2,
        active_membership_sources_with_subject: 3,
        dynamic_agents: 1,
        mcp_servers: 1,
        llm_models: 1,
        service_accounts: 1,
        slack_channel_grants: 0,
        slack_channel_team_mappings: 0,
        webex_space_grants: 0,
        webex_space_team_mappings: 0,
        credential_secret_refs: 0,
        conversations: 1,
        sharing_access: 1,
        skills: 1,
        tasks: 0,
        mcp_tool_catalog: 1,
      },
      openfga_tuple_count: 42,
      openfga_tuples_by_object_type: { agent: 1, team: 3 },
      organization_capability_tuples: [],
    },
    summary: {
      expected_tuples: 6,
      missing_tuples: 1,
      stale_references: 1,
      orphan_candidates: 1,
      repairable_findings: 1,
      total_findings: 3,
    },
    expected_by_source: { team_membership_sources: 1 },
    missing_by_source: { team_membership_sources: 1 },
    findings: [
      {
        id: "missing-team-member",
        severity: "missing",
        source: "team_membership_sources",
        title: "Missing team membership tuple",
        detail: "user:user-1 member team:platform",
        fix: "Repair the active team membership source into OpenFGA.",
        tuple: { user: "user:user-1", relation: "member", object: "team:platform" },
        repairable: true,
      },
      {
        id: "stale-agent-scope",
        severity: "stale_reference",
        source: "service_accounts.scopes_snapshot",
        title: "Service account scope references missing agent agent-private",
        detail: "CI Robot still has an agent scope for agent-private, but that agent is not in dynamic_agents.",
        fix: "Remove the stale scope from the service account or restore the missing agent.",
        repairable: false,
      },
      {
        id: "orphan",
        severity: "orphan_candidate",
        source: "openfga",
        title: "Stale Slack channel team grant",
        detail: "team:old#member user slack_channel:CAIPE--C123. Current mapped team: platform",
        fix: "The channel-team mapping changed.",
        tuple: { user: "user:old", relation: "user", object: "agent:deleted" },
        repairable: false,
        review_action: {
          type: "revoke_tuple",
          label: "Revoke tuple",
          reason: "No current source-of-truth record in this audit owns the tuple.",
        },
      },
    ],
    repair_batches: [
      {
        source: "team_membership_sources",
        finding_count: 1,
        repairable_count: 1,
        action_label: "team membership sources",
        guidance: "Repair the active team membership source into OpenFGA.",
      },
    ],
    notes: ["Repair writes only base tuples."],
  };

  return { ...base, ...overrides };
}

function testReport(overrides: Partial<RbacSelfCheckTestReport> = {}): RbacSelfCheckTestReport {
  const base: RbacSelfCheckTestReport = {
    generated_at: "2026-06-27T16:10:00.000Z",
    status: "pass",
    self_check_status: "pass",
    summary: {
      suites: 1,
      cases: 1,
      checks: 2,
      passed: 2,
      failed: 0,
      blocked: 0,
      skipped: 0,
      duration_ms: 18,
    },
    actors: [
      {
        key: "org_admin",
        label: "Current admin",
        subject_type: "user",
        subject_id: "admin-sub",
        source: "session",
        resolved: true,
        team_slugs: [],
      },
      {
        key: "member_user",
        label: "Non-admin member",
        subject_type: "user",
        subject_id: "member-sub",
        source: "inventory",
        resolved: true,
        team_slugs: ["platform"],
      },
      {
        key: "service_account",
        label: "Service account",
        subject_type: "service_account",
        subject_id: "sa-linked",
        source: "inventory",
        resolved: true,
        team_slugs: [],
      },
      {
        key: "unlinked_service_account",
        label: "Unlinked service account",
        subject_type: "service_account",
        subject_id: "sa-unlinked",
        source: "inventory",
        resolved: true,
        team_slugs: [],
      },
    ],
    suites: [
      {
        id: "credentials",
        label: "Credentials",
        description: "Credential checks",
        status: "pass",
        cases: [
          {
            id: "credentials:shared",
            title: "Shared credential",
            status: "pass",
            checks: [
              {
                id: "credentials:shared:metadata",
                title: "Shared credential metadata",
                status: "pass",
                detail: "Member can read-metadata secret_ref:shared as expected.",
              },
            ],
          },
        ],
      },
    ],
    notes: [],
  };
  return { ...base, ...overrides };
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
});

it("shows drift, stale references, and the repair plan", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: report() }));

  render(<RbacSelfCheckTab isAdmin />);

  expect(await screen.findByText("Drift detected")).toBeInTheDocument();
  expect(screen.getByText("Missing team membership tuple")).toBeInTheDocument();
  expect(screen.getByText("Service account scope references missing agent agent-private")).toBeInTheDocument();
  expect(screen.getByText("Stale Slack channel team grant")).toBeInTheDocument();
  expect(screen.getByText("Repair Plan")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Revoke tuple/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Repair Missing Tuples/i })).toBeEnabled();
  expect(fetchMock).toHaveBeenCalledWith("/api/admin/rebac/self-check", { cache: "no-store" });
});

it("repairs missing tuples and refreshes the report", async () => {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ success: true, data: report() }))
    .mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        repair: {
          requested_sources: [],
          attempted_writes: 1,
          applied_writes: 1,
          skipped_findings: 2,
        },
        report: report({
          status: "pass",
          summary: {
            expected_tuples: 6,
            missing_tuples: 0,
            stale_references: 0,
            orphan_candidates: 0,
            repairable_findings: 0,
            total_findings: 0,
          },
          findings: [],
          repair_batches: [],
        }),
      },
    }));

  render(<RbacSelfCheckTab isAdmin />);

  await screen.findByText("Drift detected");
  fireEvent.click(screen.getByRole("button", { name: /Repair Missing Tuples/i }));

  await waitFor(() => {
    expect(screen.getByText("Healthy")).toBeInTheDocument();
  });
  expect(screen.getByText("repaired 1/1")).toBeInTheDocument();
  expect(screen.getByText("No RBAC/OpenFGA drift found in the audited source records.")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/rebac/self-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
});

it("runs and repairs only selected self-tests", async () => {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ success: true, data: report() }))
    .mockResolvedValueOnce(jsonResponse({
      success: true,
      data: report({
        scope: {
          selected: ["agent_access"],
          labels: ["Agent access"],
          all: false,
        },
      }),
    }))
    .mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        repair: {
          requested_sources: [],
          attempted_writes: 1,
          applied_writes: 1,
          skipped_findings: 2,
        },
        report: report({
          scope: {
            selected: ["agent_access"],
            labels: ["Agent access"],
            all: false,
          },
        }),
      },
    }));

  render(<RbacSelfCheckTab isAdmin />);

  await screen.findByText("Drift detected");
  fireEvent.click(screen.getByRole("button", { name: "Agent access" }));
  expect(screen.getByText("Selected audit: Agent access")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Audit Selected/i }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/rebac/self-check?checks=agent_access", {
      cache: "no-store",
    });
  });
  expect(await screen.findByText("Checked Agent access")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: /Repair Missing Tuples/i }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/rebac/self-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checks: ["agent_access"] }),
    });
  });
});

it("runs the API access matrix from the self-check tab", async () => {
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ success: true, data: report() }))
    .mockResolvedValueOnce(jsonResponse({ success: true, data: testReport() }));

  render(<RbacSelfCheckTab isAdmin />);

  await screen.findByText("Drift detected");
  fireEvent.click(screen.getByRole("button", { name: /Run Access Matrix/i }));

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  expect(await screen.findByText("View results")).toBeInTheDocument();
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("Matrix tests")).toBeInTheDocument();
  expect(within(dialog).getByText("Credentials")).toBeInTheDocument();
  expect(within(dialog).getByText(/Current admin: user/)).toBeInTheDocument();
  expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/rebac/self-check/tests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
});

it("revokes a reviewed orphan tuple and refreshes the report", async () => {
  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ success: true, data: report() }))
    .mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        revoke: {
          attempted_deletes: 1,
          applied_deletes: 1,
          skipped_findings: 2,
          tuple: { user: "user:old", relation: "user", object: "agent:deleted" },
        },
        report: report({
          status: "warn",
          summary: {
            expected_tuples: 6,
            missing_tuples: 0,
            stale_references: 1,
            orphan_candidates: 0,
            repairable_findings: 0,
            total_findings: 1,
          },
          findings: [
            {
              id: "stale-agent-scope",
              severity: "stale_reference",
              source: "service_accounts.scopes_snapshot",
              title: "Service account scope references missing agent agent-private",
              detail: "CI Robot still has an agent scope for agent-private, but that agent is not in dynamic_agents.",
              fix: "Remove the stale scope from the service account or restore the missing agent.",
              repairable: false,
            },
          ],
          repair_batches: [],
        }),
      },
    }));

  render(<RbacSelfCheckTab isAdmin />);

  await screen.findByText("Stale Slack channel team grant");
  fireEvent.click(screen.getByRole("button", { name: /Revoke tuple/i }));

  await waitFor(() => {
    expect(screen.getByText("revoked 1/1")).toBeInTheDocument();
  });
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Revoke this OpenFGA tuple?"));
  expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/rebac/self-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "revoke_tuple",
      tuple: { user: "user:old", relation: "user", object: "agent:deleted" },
    }),
  });
  confirmSpy.mockRestore();
});

it("bulk revokes selected review candidates and refreshes the report", async () => {
  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  fetchMock
    .mockResolvedValueOnce(jsonResponse({ success: true, data: report() }))
    .mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        bulk_revoke: {
          requested_deletes: 1,
          attempted_deletes: 1,
          applied_deletes: 1,
          skipped_deletes: 0,
        },
        report: report({
          status: "warn",
          summary: {
            expected_tuples: 6,
            missing_tuples: 0,
            stale_references: 1,
            orphan_candidates: 0,
            repairable_findings: 0,
            total_findings: 1,
          },
          findings: [
            {
              id: "stale-agent-scope",
              severity: "stale_reference",
              source: "service_accounts.scopes_snapshot",
              title: "Service account scope references missing agent agent-private",
              detail: "CI Robot still has an agent scope for agent-private, but that agent is not in dynamic_agents.",
              fix: "Remove the stale scope from the service account or restore the missing agent.",
              repairable: false,
            },
          ],
          repair_batches: [],
        }),
      },
    }));

  render(<RbacSelfCheckTab isAdmin />);

  await screen.findByText("Stale Slack channel team grant");
  fireEvent.click(screen.getByRole("button", { name: /Select reviewable/i }));
  expect(screen.getByText("1/1 selected")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Revoke selected/i }));

  await waitFor(() => {
    expect(screen.getByText("revoked 1/1")).toBeInTheDocument();
  });
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Revoke 1 selected OpenFGA tuple?"));
  expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/rebac/self-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "revoke_tuples",
      tuples: [{ user: "user:old", relation: "user", object: "agent:deleted" }],
    }),
  });
  confirmSpy.mockRestore();
});

it("revokes all stale deleted-team membership candidates with a dedicated action", async () => {
  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  const staleTeamTuple = {
    user: "user:33607742-8cb9-4dd3-8579-166a7ac65723",
    relation: "member",
    object: "team:rbac-kb-one-1781710604916-uitbka",
  };
  fetchMock
    .mockResolvedValueOnce(jsonResponse({
      success: true,
      data: report({
        status: "warn",
        summary: {
          expected_tuples: 6,
          missing_tuples: 0,
          stale_references: 0,
          orphan_candidates: 80,
          repairable_findings: 0,
          total_findings: 80,
        },
        findings: [
          {
            id: "deleted-team-membership",
            severity: "orphan_candidate",
            source: "openfga",
            title: "Stale deleted-team membership tuple",
            detail: "user:33607742 member team:rbac-kb-one. Team rbac-kb-one is not active in Mongo.",
            fix: "Revoke this tuple to remove the dangling team membership.",
            tuple: staleTeamTuple,
            repairable: false,
            review_action: {
              type: "revoke_tuple",
              label: "Revoke tuple",
              reason: "The target team is not active in Mongo.",
            },
          },
        ],
        repair_batches: [],
        notes: [
          "Showing the first 75 of 80 unowned tuples. Re-run after cleanup to reveal the next batch.",
        ],
      }),
    }))
    .mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        bulk_revoke: {
          requested_deletes: 80,
          attempted_deletes: 80,
          applied_deletes: 80,
          skipped_deletes: 0,
        },
        report: report({
          status: "pass",
          summary: {
            expected_tuples: 6,
            missing_tuples: 0,
            stale_references: 0,
            orphan_candidates: 0,
            repairable_findings: 0,
            total_findings: 0,
          },
          findings: [],
          repair_batches: [],
        }),
      },
    }));

  render(<RbacSelfCheckTab isAdmin />);

  await screen.findByText("Stale deleted-team membership tuple");
  expect(screen.getByText("Showing 1 of 80 unowned tuples. Cleaning the displayed rows can reveal the next batch.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Revoke deleted-team memberships/i }));

  await waitFor(() => {
    expect(screen.getByText("revoked 80/80")).toBeInTheDocument();
  });
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Revoke all currently detected deleted-team membership tuples?"));
  expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/rebac/self-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "revoke_deleted_team_memberships" }),
  });
  confirmSpy.mockRestore();
});

it("cleans stale membership source rows for deleted teams", async () => {
  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  fetchMock
    .mockResolvedValueOnce(jsonResponse({
      success: true,
      data: report({
        status: "warn",
        summary: {
          expected_tuples: 6,
          missing_tuples: 0,
          stale_references: 1,
          orphan_candidates: 0,
          repairable_findings: 0,
          total_findings: 1,
        },
        findings: [
          {
            id: "stale-membership-source",
            severity: "stale_reference",
            source: "team_membership_sources",
            title: "Stale membership source for deleted team rbac-legacy-shared",
            detail: "user:user-1 is still active in team_membership_sources for team rbac-legacy-shared, but the team is not active.",
            fix: "Restore the team if it should exist, or remove this stale team_membership_sources row so it cannot recreate access drift.",
            repairable: false,
          },
        ],
        repair_batches: [],
      }),
    }))
    .mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        cleanup: {
          matched_rows: 1,
          modified_rows: 1,
          attempted_tuple_deletes: 1,
          applied_tuple_deletes: 1,
        },
        report: report({
          status: "pass",
          summary: {
            expected_tuples: 6,
            missing_tuples: 0,
            stale_references: 0,
            orphan_candidates: 0,
            repairable_findings: 0,
            total_findings: 0,
          },
          findings: [],
          repair_batches: [],
        }),
      },
    }));

  render(<RbacSelfCheckTab isAdmin />);

  await screen.findByText("Stale membership source for deleted team rbac-legacy-shared");
  expect(screen.getByText("1 active membership source row references deleted teams. Remove the source rows so they cannot recreate access drift.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Remove stale source rows/i }));

  await waitFor(() => {
    expect(screen.getByText("cleaned 1/1 source rows")).toBeInTheDocument();
  });
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Remove stale team membership source rows for deleted teams?"));
  expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/rebac/self-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cleanup_stale_team_membership_sources" }),
  });
  confirmSpy.mockRestore();
});

it("cleans stale resource references from the self-check tab", async () => {
  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  fetchMock
    .mockResolvedValueOnce(jsonResponse({
      success: true,
      data: report({
        status: "warn",
        summary: {
          expected_tuples: 6,
          missing_tuples: 0,
          stale_references: 2,
          orphan_candidates: 0,
          repairable_findings: 0,
          total_findings: 2,
        },
        findings: [
          {
            id: "stale-agent-scope",
            severity: "stale_reference",
            source: "service_accounts.scopes_snapshot",
            title: "Service account scope references missing agent agent-private",
            detail: "CI Robot still has an agent scope for agent-private, but that agent is not in dynamic_agents.",
            fix: "Remove the stale scope from the service account or restore the missing agent.",
            repairable: false,
          },
          {
            id: "stale-webex-grant",
            severity: "stale_reference",
            source: "webex_space_grants",
            title: "Webex grant references missing agent agent-private",
            detail: "Webex space Cisco/space-1 grants agent:agent-private, but that resource was not found.",
            fix: "Remove the stale Webex grant or restore the target resource.",
            repairable: false,
          },
        ],
        repair_batches: [],
      }),
    }))
    .mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        cleanup: {
          matched_rows: 2,
          modified_rows: 2,
          attempted_tuple_deletes: 2,
          applied_tuple_deletes: 2,
        },
        report: report({
          status: "pass",
          summary: {
            expected_tuples: 6,
            missing_tuples: 0,
            stale_references: 0,
            orphan_candidates: 0,
            repairable_findings: 0,
            total_findings: 0,
          },
          findings: [],
          repair_batches: [],
        }),
      },
    }));

  render(<RbacSelfCheckTab isAdmin />);

  await screen.findByText("Service account scope references missing agent agent-private");
  expect(screen.getByText("2 service-account or messaging grant references point at missing resources. Remove the source refs so they cannot recreate access drift.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Remove stale resource refs/i }));

  await waitFor(() => {
    expect(screen.getByText("cleaned 2/2 source rows")).toBeInTheDocument();
  });
  expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Remove stale resource references?"));
  expect(fetchMock).toHaveBeenLastCalledWith("/api/admin/rebac/self-check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "cleanup_stale_resource_references" }),
  });
  confirmSpy.mockRestore();
});

it("requires admin access", () => {
  render(<RbacSelfCheckTab isAdmin={false} />);

  expect(screen.getByText("Admin access required.")).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});
