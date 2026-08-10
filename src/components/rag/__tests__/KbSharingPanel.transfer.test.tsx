/**
 * @jest-environment jsdom
 *
 * Covers the "Confirm Transfer" recovery flow on KbSharingPanel: when the BFF
 * rejects an ownership transfer to a team the caller is not an OpenFGA member
 * of (TRANSFER_NOT_MEMBER_UNCONFIRMED), the panel must surface an inline
 * confirm-and-retry instead of a dead-end error, and the retry must carry
 * `confirm_not_member: true`.
 */

import React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// TeamOwnershipFields pulls in the team pickers / popovers; stub it to a minimal
// control surface so this test focuses on KbSharingPanel's transfer logic.
jest.mock("@/components/rbac/TeamOwnershipFields", () => ({
  TeamOwnershipFields: ({
    onOwnerTeamChange,
    onTransfer,
  }: {
    onOwnerTeamChange: (slug: string) => void;
    onTransfer?: (slug: string, confirmedNotMember: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid="mock-transfer-owner"
      onClick={() => {
        // Simulate the user choosing a new owner team they are not a member of.
        onOwnerTeamChange("other-team");
        onTransfer?.("other-team", false);
      }}
    >
      Change owner
    </button>
  ),
}));

import { KbSharingPanel } from "../KbSharingPanel";

const KB_ID = "kb-1";

function jsonOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function jsonErr(status: number, body: unknown) {
  return { ok: false, status, statusText: "Conflict", json: async () => body };
}

/** Initial GET /sharing + GET /teams responses. */
function primeInitialFetch(fetchMock: jest.Mock) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/sharing")) {
      return jsonOk({
        knowledge_base_id: KB_ID,
        shared_team_slugs: [],
        owner_team_slug: "platform",
        creator_subject: "user-1",
      });
    }
    if (url.includes("/api/dynamic-agents/teams")) {
      return jsonOk({
        success: true,
        data: [
          { _id: "t1", slug: "platform", name: "Platform" },
          { _id: "t2", slug: "other-team", name: "Other Team" },
        ],
      });
    }
    return jsonOk({});
  });
}

describe("KbSharingPanel — Confirm Transfer recovery", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    // @ts-expect-error test override
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("surfaces an inline Confirm Transfer button and retries with confirm_not_member: true", async () => {
    const user = userEvent.setup();
    primeInitialFetch(fetchMock);

    render(<KbSharingPanel knowledgeBaseId={KB_ID} />);

    // Wait for initial load to settle.
    await waitFor(() =>
      expect(screen.getByTestId("mock-transfer-owner")).toBeInTheDocument(),
    );

    // Mark a pending ownership transfer to a team the caller isn't a member of.
    await act(async () => {
      await user.click(screen.getByTestId("mock-transfer-owner"));
    });

    // The first PUT is rejected with the not-a-member code.
    fetchMock.mockImplementationOnce(async () =>
      jsonErr(409, { code: "TRANSFER_NOT_MEMBER_UNCONFIRMED", error: "not a member" }),
    );

    await act(async () => {
      await user.click(screen.getByRole("button", { name: /save sharing/i }));
    });

    // Inline confirm affordance appears (not just a transient error).
    const confirmBtn = await screen.findByRole("button", { name: /confirm transfer/i });
    expect(confirmBtn).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(/not a member of the destination team/i);

    // The retry succeeds.
    fetchMock.mockImplementationOnce(async () =>
      jsonOk({
        knowledge_base_id: KB_ID,
        shared_team_slugs: [],
        owner_team_slug: "other-team",
      }),
    );

    await act(async () => {
      await user.click(confirmBtn);
    });

    // Find the PUT that carried confirm_not_member: true.
    const putCalls = fetchMock.mock.calls.filter(
      ([, init]) => init?.method === "PUT",
    );
    expect(putCalls.length).toBeGreaterThanOrEqual(2);
    const retryBody = JSON.parse(putCalls[putCalls.length - 1][1].body);
    expect(retryBody).toMatchObject({
      owner_team_slug: "other-team",
      confirm_not_member: true,
    });

    // Success message replaces the error.
    await waitFor(() =>
      expect(screen.getByText(/ownership transferred/i)).toBeInTheDocument(),
    );
  });
});
