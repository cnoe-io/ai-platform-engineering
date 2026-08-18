import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuthzGraphLayers } from "../authz-graph-layers";

const baseEvent = {
  tenant_id: "example",
  subject_hash: "sha256:example",
  outcome: "success" as const,
  source: "caipe-authz" as const,
};

describe("AuthzGraphLayers", () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/admin/openfga/graph")) {
        return { ok: true, json: async () => ({ nodes: [], edges: [] }) } as Response;
      }
      if (url.includes("authz_policy_change")) {
        return {
          ok: true,
          json: async () => ({ records: [{
            ...baseEvent,
            audit_event_id: "policy-event",
            ts: "2026-08-18T01:00:00Z",
            type: "authz_policy_change",
            action: "update",
            operation: "update",
            correlation_id: "policy-correlation",
            resource_ref: "tool:issue_tracker/create_item",
            policy_id: "policy-example",
            after_revision: 2,
          }] }),
        } as Response;
      }
      if (url.includes("authz_relationship_change")) {
        return { ok: true, json: async () => ({ records: [] }) } as Response;
      }
      if (url.includes("authz_migration_comparison")) {
        return {
          ok: true,
          json: async () => ({ records: [{
            ...baseEvent,
            audit_event_id: "comparison-event",
            ts: "2026-08-18T01:01:00Z",
            type: "authz_migration_comparison",
            action: "invoke",
            correlation_id: "comparison-correlation",
            rollout_revision: "revision-2",
            authoritative_path: "AUTHZ",
            mismatch_class: "NONE",
            legacy_outcome: "allow",
            authz_outcome: "allow",
          }] }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ records: [{
          ...baseEvent,
          audit_event_id: "revision-event",
          ts: "2026-08-18T01:02:00Z",
          type: "authz_migration_revision",
          action: "authz_migration_revision",
          correlation_id: "revision-correlation",
          rollout_revision: "revision-2",
          default_mode: "LEGACY",
          scopes: [{ mode: "AUTHZ" }],
        }] }),
      } as Response;
    }) as jest.Mock;
  });

  it("separates conditional state, history, comparisons, and revisions without values", async () => {
    const user = userEvent.setup();
    render(<AuthzGraphLayers graph={{
      nodes: [
        { id: "user:example-user", label: "user:example-user", type: "user" },
        { id: "tool:issue_tracker/create_item", label: "tool:issue_tracker/create_item", type: "tool" },
      ],
      edges: [{
        id: "conditional-edge",
        from: "user:example-user",
        to: "tool:issue_tracker/create_item",
        relation: "conditional_caller",
        conditional: true,
        condition_name: "string_argument_in_v1",
        policy: {
          policy_id: "policy-example",
          status: "STALE",
          template: "string_argument_in_v1",
          field: "/project_key",
          schema_hash: `sha256:${"a".repeat(64)}`,
          version: 2,
          exclusive: true,
          schema_drift: true,
          shadow_warnings: ["wildcard_allow"],
        },
      }],
    }} />);

    await waitFor(() => expect(screen.getByText("schema drift")).toBeInTheDocument());
    expect(screen.getByText("shadowed: wildcard_allow")).toBeInTheDocument();
    expect(screen.queryByText("sensitive-value-that-must-never-escape")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "History (1)" }));
    expect(await screen.findByText("policy-example")).toBeInTheDocument();
    expect(screen.getByText("revision 2")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Comparisons (1)" }));
    expect(screen.getByText("AUTHZ")).toBeInTheDocument();
    expect(screen.getByText("legacy allow")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Revisions (1)" }));
    expect(screen.getByText("default LEGACY")).toBeInTheDocument();
    expect(screen.getByText("1 scoped override(s)")).toBeInTheDocument();
  });
});
