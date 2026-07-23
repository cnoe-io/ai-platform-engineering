import { fireEvent,render,screen,waitFor } from "@testing-library/react";

import { UserDetailPanel } from "../UserDetailPanel";

describe("UserDetailPanel", () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          can_view_conversations: true,
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
            feedback_given: 1,
            feedback_positive: 1,
            feedback_negative: 0,
          },
          recent_conversations: [
            {
              id: "conversation-1",
              title: "Example Slack thread",
              source: "slack",
              channel_id: "C123TEST",
              channel_name: "example-channel",
              slack_permalink:
                "https://example.slack.com/archives/C123TEST/p1775100000123456",
              created_at: "2026-07-20T00:00:00.000Z",
              updated_at: "2026-07-20T01:00:00.000Z",
            },
          ],
          recent_feedback: [
            {
              source: "web",
              rating: "positive",
              value: "thumbs_up",
              comment: "Helpful",
              channel_name: null,
              conversation_id: "conversation-1",
              slack_permalink: null,
              created_at: "2026-07-20T01:00:00.000Z",
            },
          ],
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

  it("links an admin's Slack conversation to its persisted thread permalink", async () => {
    render(
      <UserDetailPanel
        email="test-user@example.com"
        onClose={jest.fn()}
      />,
    );

    await screen.findByText("Test User");
    fireEvent.click(screen.getByRole("button", { name: "Conversations (1)" }));

    expect(
      screen.getByRole("link", { name: "Example Slack thread" }),
    ).toHaveAttribute(
      "href",
      "https://example.slack.com/archives/C123TEST/p1775100000123456",
    );
  });

  it("hides conversation tabs, titles, and feedback chat links for a scoped viewer", async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          can_view_conversations: false,
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
            feedback_given: 1,
            feedback_positive: 1,
            feedback_negative: 0,
          },
          // Defense in depth: even a malformed response must not render these
          // rows when the server capability says conversation access is denied.
          recent_conversations: [
            {
              id: "conversation-private",
              title: "Private conversation title",
              source: "web",
              channel_id: null,
              channel_name: null,
              slack_permalink: null,
              created_at: "2026-07-20T00:00:00.000Z",
              updated_at: "2026-07-20T01:00:00.000Z",
            },
          ],
          recent_feedback: [
            {
              source: "web",
              rating: "positive",
              value: "thumbs_up",
              comment: "Helpful",
              channel_name: null,
              conversation_id: "conversation-private",
              slack_permalink: null,
              created_at: "2026-07-20T01:00:00.000Z",
            },
          ],
        },
      }),
    });

    render(
      <UserDetailPanel
        email="test-user@example.com"
        onClose={jest.fn()}
      />,
    );

    await screen.findByText("Test User");
    expect(
      screen.queryByRole("button", { name: /Conversations/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Private conversation title")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Feedback (1)" }));
    expect(screen.getByText("Helpful")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "View chat" })).not.toBeInTheDocument();
  });
});
