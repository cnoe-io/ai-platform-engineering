import { render, screen, waitFor } from "@testing-library/react";
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

  it("prefills GitLab.com connector defaults from the built-in provider template", async () => {
    const user = userEvent.setup();
    render(<OAuthConnectorAdminPanel />);

    await screen.findByText("GitHub");
    await user.click(screen.getByRole("button", { name: /add oauth provider/i }));
    await user.selectOptions(screen.getByLabelText(/built-in template/i), "gitlab");

    expect(screen.getByLabelText(/display name/i)).toHaveValue("GitLab");
    expect(screen.getByLabelText(/^provider/i)).toHaveValue("gitlab");
    expect(screen.getByLabelText(/authorization url/i)).toHaveValue("https://gitlab.com/oauth/authorize");
    expect(screen.getByLabelText(/token url/i)).toHaveValue("https://gitlab.com/oauth/token");
    expect(screen.getByLabelText(/scopes/i)).toHaveValue("api read_user");

    await user.type(screen.getByLabelText(/client id/i), "gitlab-client");
    await user.type(screen.getByLabelText(/client secret/i), "gitlab-secret");
    await user.type(
      screen.getByLabelText(/redirect uri/i),
      "https://caipe.example.com/api/credentials/oauth/gitlab/callback",
    );
    await user.click(screen.getByRole("button", { name: /save connector/i }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/credentials/oauth-connectors",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"provider":"gitlab"'),
        }),
      ),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/credentials/oauth-connectors",
      expect.objectContaining({
        body: expect.stringContaining('"authorizationUrl":"https://gitlab.com/oauth/authorize"'),
      }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/credentials/oauth-connectors",
      expect.objectContaining({
        body: expect.stringContaining('"scopes":["api","read_user"]'),
      }),
    );
  });

  it("lets admins enable disabled OAuth providers", async () => {
    const user = userEvent.setup();
    global.fetch = jest.fn(async (_url, init) => {
      if (init?.method === "PATCH") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { id: "gitlab-connector", enabled: true },
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              id: "gitlab-connector",
              name: "GitLab",
              provider: "gitlab",
              clientId: "gitlab-client",
              enabled: false,
              clientSecretConfigured: true,
            },
          ],
        }),
      } as Response;
    }) as jest.Mock;

    render(<OAuthConnectorAdminPanel />);

    expect(await screen.findByText("disabled")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^enable$/i }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/credentials/oauth-connectors/gitlab-connector",
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ action: "enable" }),
        }),
      ),
    );
    expect(screen.getByText("enabled")).toBeInTheDocument();
  });
});
