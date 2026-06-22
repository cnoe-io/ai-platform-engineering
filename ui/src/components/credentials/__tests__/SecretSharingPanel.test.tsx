// assisted-by Codex Codex-sonnet-4-6

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { pickTeam } from "@/__test-utils__/team-picker";

import { SecretSharingPanel } from "../SecretSharingPanel";

describe("SecretSharingPanel", () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (url) => {
      if (String(url) === "/api/admin/teams") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              teams: [
                { _id: "team-1", slug: "platform-team", name: "Platform Team" },
                { _id: "team-2", slug: "security-team", name: "Security Team" },
              ],
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response;
    }) as jest.Mock;
  });

  it("shares a secret with a team without exposing the value", async () => {
    const user = userEvent.setup();
    const onSharingChange = jest.fn();
    render(
      <SecretSharingPanel secretId="secret-1" sharedWithTeams={[]} onSharingChange={onSharingChange} />,
    );

    await pickTeam(/team access/i, "platform-team");
    await user.click(screen.getByRole("button", { name: /grant access/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/credentials/secrets/secret-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ action: "share", teamId: "platform-team" }),
      }),
    );
    await waitFor(() => expect(onSharingChange).toHaveBeenCalledWith(["platform-team"]));
    expect(screen.getByLabelText(/team access/i)).toHaveTextContent("Platform Team");
    expect(screen.getByLabelText(/team access/i)).toHaveTextContent("team:platform-team");
    expect(screen.queryByText("Shared with Platform Team")).not.toBeInTheDocument();
    expect(screen.getByText(/Choose a team that can use this saved secret/i)).toBeInTheDocument();
    expect(JSON.stringify((global.fetch as jest.Mock).mock.calls)).not.toContain("secret-value");
  });

  it("can revoke a selected team without listing current audiences", async () => {
    const user = userEvent.setup();
    const onSharingChange = jest.fn();
    render(
      <SecretSharingPanel
        secretId="secret-1"
        sharedWithTeams={["platform-team"]}
        onSharingChange={onSharingChange}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText(/team access/i)).not.toBeDisabled());
    expect(screen.getByLabelText(/team access/i)).toHaveTextContent("Platform Team");
    expect(screen.getByLabelText(/team access/i)).toHaveTextContent("team:platform-team");
    await user.click(screen.getByRole("button", { name: /revoke access/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/credentials/secrets/secret-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ action: "revoke", teamId: "platform-team" }),
      }),
    );
    await waitFor(() => expect(onSharingChange).toHaveBeenCalledWith([]));
    expect(screen.queryByText("Shared with Platform Team")).not.toBeInTheDocument();
  });

  it("recognizes legacy team ids as already shared and revokes the stored identifier", async () => {
    const user = userEvent.setup();
    const onSharingChange = jest.fn();
    render(
      <SecretSharingPanel
        secretId="secret-1"
        sharedWithTeams={["team-1"]}
        onSharingChange={onSharingChange}
      />,
    );

    await waitFor(() => expect(screen.getByLabelText(/team access/i)).toHaveTextContent("Platform Team"));
    expect(screen.getByLabelText(/team access/i)).toHaveTextContent("team:platform-team");
    await user.click(screen.getByRole("button", { name: /revoke access/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/credentials/secrets/secret-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ action: "revoke", teamId: "team-1" }),
      }),
    );
    await waitFor(() => expect(onSharingChange).toHaveBeenCalledWith([]));
    expect(screen.queryByText("Shared with Platform Team")).not.toBeInTheDocument();
  });

  it("keeps local sharing state unchanged when the API rejects an update", async () => {
    const user = userEvent.setup();
    const onSharingChange = jest.fn();
    (global.fetch as jest.Mock).mockImplementation(async (url) => {
      if (String(url) === "/api/admin/teams") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { teams: [{ _id: "team-1", slug: "platform-team", name: "Platform Team" }] },
          }),
        } as Response;
      }
      return {
        ok: false,
        json: async () => ({ success: false, error: "denied" }),
      } as Response;
    });
    render(
      <SecretSharingPanel secretId="secret-1" sharedWithTeams={[]} onSharingChange={onSharingChange} />,
    );

    await pickTeam(/team access/i, "platform-team");
    await user.click(screen.getByRole("button", { name: /grant access/i }));

    expect(await screen.findByText(/Could not update sharing/i)).toBeInTheDocument();
    expect(onSharingChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Shared with Platform Team")).not.toBeInTheDocument();
  });
});
