/** @jest-environment jsdom */

import { render, screen } from "@testing-library/react";

const mockToast = jest.fn();

jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: (key: string) => key === "view" ? "history" : null,
  }),
}));

import { PublicationApprovalQueue } from "../PublicationApprovalQueue";

describe("PublicationApprovalQueue", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("shows who approved a publication in History", async () => {
    const approvedRequest = {
      _id: "request-primary",
      adapter_version: 1 as const,
      resource: {
        kind: "rag_datasource" as const,
        id: "source-primary",
        label: "Primary handbook",
      },
      authorization_policy_id: "publication/request-primary",
      resource_revision: "revision-primary",
      requested_state: {
        search_team_slugs: [],
        search_user_subjects: [],
      },
      effective_state: {
        search_team_slugs: ["everyone"],
        search_user_subjects: [],
      },
      risk_facts: {
        organization_wide: true,
        target_team_slugs: ["everyone"],
        removed_team_slugs: ["everyone"],
        reasons: ["organization-wide audience removal"],
      },
      requester: {
        subject: "requester-subject",
        name: "Requesting User",
      },
      requester_team_slugs: [],
      approver_team_slugs: [],
      approver_user_subjects: [],
      status: "approved" as const,
      history: [{
        action: "approved" as const,
        at: "2026-01-02T00:00:00.000Z",
        actor: {
          subject: "reviewer-subject",
          name: "Review Admin",
        },
      }],
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
      decided_at: "2026-01-02T00:00:00.000Z",
      decided_by: {
        subject: "reviewer-subject",
        name: "Review Admin",
      },
    };
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/publication-requests/summary") {
        return {
          ok: true,
          json: async () => ({
            pending_count: 0,
            can_approve: true,
            can_manage_settings: true,
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ requests: [approvedRequest] }),
      } as Response;
    });

    render(<PublicationApprovalQueue />);

    expect(await screen.findByText("Approved by Review Admin")).toBeInTheDocument();
    expect(screen.getByText("Remove Search for: Everyone")).toBeInTheDocument();
  });
});
