import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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
    render(<SecretSharingPanel secretId="secret-1" sharedWithTeams={[]} />);

    await screen.findByText("Platform Team");
    await user.selectOptions(await screen.findByLabelText(/team/i), "platform-team");
    await user.click(screen.getByRole("button", { name: /share/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/credentials/secrets/secret-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ action: "share", teamId: "platform-team" }),
      }),
    );
    expect(JSON.stringify((global.fetch as jest.Mock).mock.calls)).not.toContain("secret-value");
  });

  it("removes already-shared teams from the dropdown", async () => {
    render(<SecretSharingPanel secretId="secret-1" sharedWithTeams={["platform-team"]} />);

    await screen.findByText("Security Team");
    const selector = await screen.findByLabelText(/team/i);
    expect(selector).not.toHaveTextContent("Platform Team");
    expect(selector).toHaveTextContent("Security Team");
  });
});
