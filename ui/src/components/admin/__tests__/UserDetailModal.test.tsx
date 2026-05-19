import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UserDetailModal } from "../UserDetailModal";

const updateSession = jest.fn();

jest.mock("next-auth/react", () => ({
  useSession: () => ({ update: updateSession }),
}));

const userResponse = {
  success: true,
  data: {
    user: {
      id: "user-1",
      username: "sri",
      email: "sraradhy@cisco.com",
      firstName: "Sri",
      lastName: "Aradhyula",
      enabled: true,
      createdAt: 0,
      attributes: { slack_user_id: ["U123SLACK"], webex_user_id: ["person-abc"] },
      slackLinkStatus: "linked",
      realmRoles: [
        { id: "legacy-admin", name: "admin" },
        { id: "legacy-chat", name: "chat_user" },
        { id: "legacy-kb", name: "kb_reader:kb-1" },
        { id: "legacy-agent", name: "agent_user:agent-1" },
      ],
      sessions: [],
      federatedIdentities: [],
      teams: [{ team_id: "platform", tenant_id: "caipe" }],
      lastAccess: null,
    },
  },
};

const teamsResponse = {
  success: true,
  data: {
    teams: [{ name: "platform" }, { name: "security" }],
  },
};

describe("UserDetailModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(window, "confirm").mockReturnValue(true);
    global.fetch = jest.fn((url: string) => {
      if (url.includes("/api/admin/slack/users/user-1")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, data: { revoked: true } }),
        });
      }
      if (url.includes("/api/admin/webex/users/user-1")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ success: true, data: { revoked: true } }),
        });
      }
      if (url.includes("/api/admin/users/user-1")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(userResponse),
        });
      }
      if (url.includes("/api/admin/teams")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(teamsResponse),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ success: false, error: "unexpected fetch" }),
      });
    }) as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not expose Keycloak role management in the user detail modal", async () => {
    render(
      <UserDetailModal
        userId="user-1"
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );

    expect(await screen.findByText("Sri Aradhyula")).toBeInTheDocument();

    expect(screen.queryByText("Realm roles")).not.toBeInTheDocument();
    expect(screen.queryByText("Per-KB roles")).not.toBeInTheDocument();
    expect(screen.queryByText("Per-agent roles")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Add role")).not.toBeInTheDocument();
    expect(screen.queryByText("admin")).not.toBeInTheDocument();
    expect(screen.queryByText("chat_user")).not.toBeInTheDocument();

    await waitFor(() => {
      expect(global.fetch).not.toHaveBeenCalledWith("/api/admin/roles");
    });
  });

  it("shows Webex link status from webex_user_id attribute", async () => {
    render(
      <UserDetailModal
        userId="user-1"
        onClose={jest.fn()}
        onSaved={jest.fn()}
      />
    );

    expect(await screen.findByText("person-abc")).toBeInTheDocument();
    expect(screen.getByText("Webex")).toBeInTheDocument();
  });

  it("can unlink Webex identity from the user detail modal", async () => {
    const onSaved = jest.fn();
    render(
      <UserDetailModal
        userId="user-1"
        onClose={jest.fn()}
        onSaved={onSaved}
      />
    );

    expect(await screen.findByText("person-abc")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /unlink webex/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/admin/webex/users/user-1", {
        method: "DELETE",
      });
      expect(onSaved).toHaveBeenCalled();
    });
  });

  it("can unlink Slack identity from the user detail modal", async () => {
    const onSaved = jest.fn();
    render(
      <UserDetailModal
        userId="user-1"
        onClose={jest.fn()}
        onSaved={onSaved}
      />
    );

    expect(await screen.findByText("U123SLACK")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /unlink slack/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/admin/slack/users/user-1", {
        method: "DELETE",
      });
      expect(onSaved).toHaveBeenCalled();
    });
  });
});
