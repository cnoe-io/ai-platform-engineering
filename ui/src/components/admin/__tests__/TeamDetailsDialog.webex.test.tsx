import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { TeamDetailsDialog } from "../TeamDetailsDialog";
import type { Team } from "@/types/teams";

const fetchMock = jest.fn();

const team: Team = {
  _id: "team-1",
  slug: "platform",
  name: "Platform Engineering",
  owner_id: "owner@example.com",
  created_at: new Date("2026-01-01"),
  updated_at: new Date("2026-01-01"),
  members: [],
};

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/teams/team-1/slack-channels" && (!init?.method || init.method === "GET")) {
      return jsonResponse({
        success: true,
        data: {
          team_id: "team-1",
          channels: [],
        },
      });
    }
    if (url.startsWith("/api/admin/slack/available-channels")) {
      const parsed = new URL(url, "http://localhost");
      const cursor = parsed.searchParams.get("cursor");
      return jsonResponse({
        success: true,
        data: {
          channels:
            cursor === "next-page"
              ? [
                  {
                    id: "C0NEXTCHAN",
                    name: "next-slack-channel",
                    is_private: false,
                    is_member: true,
                    num_members: 8,
                  },
                ]
              : [
                  {
                    id: "C0B4GLC5EFQ",
                    name: "new-slack-channel",
                    is_private: false,
                    is_member: true,
                    num_members: 4,
                  },
                ],
          total_matches: 184,
          total_visible: 184,
          next_cursor: cursor ? null : "next-page",
          has_more: !cursor,
          cached: false,
          fetched_at: Date.now(),
          query: { q: "", member_only: true, limit: 50 },
        },
      });
    }
    if (url === "/api/admin/teams/team-1/webex-spaces" && (!init?.method || init.method === "GET")) {
      return jsonResponse({
        success: true,
        data: {
          team_id: "team-1",
          spaces: [{ webex_space_id: "space-1", space_name: "Alerts" }],
        },
      });
    }
    if (url === "/api/admin/teams/team-1/webex-spaces" && init?.method === "PUT") {
      return jsonResponse({
        success: true,
        data: {
          team_id: "team-1",
          spaces: [{ webex_space_id: "space-2", space_name: "Ops" }],
          removed_space_ids: ["space-1"],
        },
      });
    }
    if (url.startsWith("/api/admin/webex/available-spaces")) {
      return jsonResponse({
        success: true,
        data: {
          spaces: [{ id: "space-2", name: "Ops", type: "group", is_locked: false }],
          total_matches: 1,
          total_visible: 1,
          next_cursor: null,
          has_more: false,
          cached: false,
          fetched_at: Date.now(),
          query: { q: "", limit: 200 },
        },
      });
    }
    return jsonResponse({ success: true, data: {} });
  });
});

function jsonResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

it("auto-loads bot-member Slack channels when the team Slack tab opens", async () => {
  render(
    <TeamDetailsDialog
      team={team}
      mode="channels"
      open
      onOpenChange={jest.fn()}
      onTeamUpdated={jest.fn()}
    />
  );

  expect(await screen.findByText("new-slack-channel")).toBeInTheDocument();
  expect(screen.getByText("C0B4GLC5EFQ")).toBeInTheDocument();
  expect(screen.getByPlaceholderText("Search bot-member channels...")).toBeInTheDocument();
  expect(screen.getByText("184 bot-member channels found. Showing 1.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refresh bot channels" })).toBeInTheDocument();
  expect(screen.queryByText(/Click Discover to list channels/i)).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(/^\/api\/admin\/slack\/available-channels\?.*member_only=1.*limit=50/)
  );

  fireEvent.click(screen.getByRole("button", { name: /Load more/i }));

  expect(await screen.findByText("next-slack-channel")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(
      /^\/api\/admin\/slack\/available-channels\?.*member_only=1.*limit=50.*cursor=next-page/
    )
  );
});

it("loads and saves Webex space bindings from the team dialog", async () => {
  render(
    <TeamDetailsDialog
      team={team}
      mode="webex"
      open
      onOpenChange={jest.fn()}
      onTeamUpdated={jest.fn()}
    />
  );

  expect(await screen.findByText(/webex_space_team_mappings/)).toBeInTheDocument();
  expect(await screen.findByText("Alerts")).toBeInTheDocument();

  const manualId = await screen.findByPlaceholderText("Y2lzY29zcGFyazov...");
  fireEvent.change(manualId, { target: { value: "space-2" } });
  fireEvent.change(screen.getByPlaceholderText("Space title"), {
    target: { value: "Ops" },
  });
  const manualRow = manualId.parentElement;
  expect(manualRow).toBeTruthy();
  fireEvent.click(within(manualRow!).getByRole("button"));
  fireEvent.click(screen.getByRole("button", { name: "Save Spaces" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/teams/team-1/webex-spaces",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"webex_space_id":"space-2"'),
      })
    )
  );
});
