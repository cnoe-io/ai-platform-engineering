import { render,screen,waitFor } from "@testing-library/react";

import { UserDetailPanel } from "../UserDetailPanel";

describe("UserDetailPanel", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          profile: {
            email: "test-user@example.com",
            name: "Test User",
            avatar_url: null,
            role: "user",
            source: "web",
            slack_user_id: null,
            created_at: "2026-01-01T00:00:00.000Z",
            last_login: "2026-07-20T00:00:00.000Z",
          },
          stats: {
            total_conversations: 1,
            feedback_given: 0,
            feedback_positive: 0,
            feedback_negative: 0,
          },
          recent_conversations: [],
          recent_feedback: [],
        },
      }),
    }) as jest.Mock;
  });

  it("uses the Mongo activity endpoint instead of the Keycloak id endpoint", async () => {
    render(
      <UserDetailPanel
        email="test-user@example.com"
        onClose={jest.fn()}
      />,
    );

    await screen.findByText("Test User");
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/users/activity/test-user%40example.com",
      );
    });
  });
});
