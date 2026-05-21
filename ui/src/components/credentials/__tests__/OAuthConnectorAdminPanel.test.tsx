import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OAuthConnectorAdminPanel } from "../OAuthConnectorAdminPanel";

describe("OAuthConnectorAdminPanel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async (_url, init) => {
      if (init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: "connector-2",
              name: "Jira",
              provider: "atlassian",
              clientId: "jira-client",
              clientSecretConfigured: true,
            },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              id: "connector-1",
              name: "GitHub",
              provider: "github",
              clientId: "github-client",
              clientSecretConfigured: true,
            },
          ],
        }),
      } as Response;
    }) as jest.Mock;
  });

  it("lists connectors without exposing client secrets", async () => {
    render(<OAuthConnectorAdminPanel />);

    expect(await screen.findByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("client secret configured")).toBeInTheDocument();
    expect(screen.queryByText("oauth_connector:connector-1:client_secret")).not.toBeInTheDocument();
    expect(screen.queryByText("client-secret")).not.toBeInTheDocument();
  });

  it("submits connector client secret only to the admin create endpoint", async () => {
    const user = userEvent.setup();
    render(<OAuthConnectorAdminPanel />);

    await screen.findByText("GitHub");
    expect(screen.queryByLabelText(/client secret/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /add oauth provider/i }));
    await user.type(screen.getByLabelText(/display name/i), "Jira");
    await user.type(screen.getByLabelText(/^provider/i), "atlassian");
    await user.type(screen.getByLabelText(/client id/i), "jira-client");
    await user.type(screen.getByLabelText(/client secret/i), "client-secret");
    await user.type(screen.getByLabelText(/authorization url/i), "https://auth.atlassian.com/authorize");
    await user.type(screen.getByLabelText(/token url/i), "https://auth.atlassian.com/oauth/token");
    await user.type(screen.getByLabelText(/redirect uri/i), "https://caipe.example.com/callback");
    await user.click(screen.getByRole("button", { name: /save connector/i }));

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/credentials/oauth-connectors",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("client-secret"),
      }),
    );
  });
});
