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

  it("labels PKCE (public client) connectors instead of showing a secret badge", async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: "connector-1",
            name: "CO2",
            provider: "co2-dev",
            clientId: "co2-client",
            pkce: true,
            clientSecretConfigured: false,
          },
        ],
      }),
    })) as jest.Mock;

    render(<OAuthConnectorAdminPanel />);

    expect(await screen.findByText("CO2")).toBeInTheDocument();
    expect(screen.getByText("public client (PKCE)")).toBeInTheDocument();
    expect(screen.queryByText("client secret configured")).not.toBeInTheDocument();
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
    // `^client secret$` so the PKCE checkbox label ("...no client secret")
    // does not also match.
    await user.type(screen.getByLabelText(/^client secret$/i), "client-secret");
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
    await user.type(screen.getByLabelText(/^client secret$/i), "gitlab-secret");
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
    // The action buttons now carry per-connector aria-labels (e.g. "Enable
    // GitLab") for accessibility, so match on that rather than a bare "Enable".
    await user.click(screen.getByRole("button", { name: /^enable gitlab$/i }));

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

  it("creates a PKCE (public client) connector without a client secret field", async () => {
    const user = userEvent.setup();
    render(<OAuthConnectorAdminPanel />);

    await screen.findByText("GitHub");
    await user.click(screen.getByRole("button", { name: /add oauth provider/i }));

    // Toggling PKCE hides the client-secret field entirely.
    expect(screen.getByLabelText(/^client secret$/i)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/public client \(pkce/i));
    expect(screen.queryByLabelText(/^client secret$/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText(/display name/i), "CO2");
    await user.type(screen.getByLabelText(/^provider/i), "co2-dev");
    await user.type(screen.getByLabelText(/client id/i), "co2-client");
    await user.type(screen.getByLabelText(/authorization url/i), "https://idp.example.com/oauth/authorize");
    await user.type(screen.getByLabelText(/token url/i), "https://idp.example.com/oauth/token");
    await user.type(screen.getByLabelText(/redirect uri/i), "https://caipe.example.com/api/credentials/oauth/co2-dev/callback");
    await user.click(screen.getByRole("button", { name: /save connector/i }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/credentials/oauth-connectors",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"pkce":true'),
        }),
      ),
    );
  });

  it("edits an existing connector via PUT and labels the dialog as Edit", async () => {
    const user = userEvent.setup();
    // The edit form prefills from the full connector record (scopes, URLs),
    // so this test needs a fully-populated GET payload, not the minimal one.
    global.fetch = jest.fn(async (_url, init) => {
      if (init?.method === "PUT") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { id: "connector-1", name: "GitHub Enterprise", provider: "github" },
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
              authorizationUrl: "https://github.com/login/oauth/authorize",
              tokenUrl: "https://github.com/login/oauth/access_token",
              scopes: ["repo", "read:user"],
              redirectUri: "https://caipe.example.com/api/credentials/oauth/github/callback",
              clientSecretConfigured: true,
            },
          ],
        }),
      } as Response;
    }) as jest.Mock;

    render(<OAuthConnectorAdminPanel />);

    await screen.findByText("GitHub");
    await user.click(screen.getByRole("button", { name: /^edit github$/i }));

    // The dialog's accessible name must reflect edit mode, not "Add".
    expect(screen.getByRole("dialog", { name: /edit oauth provider/i })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /add oauth provider/i })).not.toBeInTheDocument();
    // Fields are prefilled from the connector being edited.
    expect(screen.getByLabelText(/display name/i)).toHaveValue("GitHub");

    await user.clear(screen.getByLabelText(/display name/i));
    await user.type(screen.getByLabelText(/display name/i), "GitHub Enterprise");
    // The secret field is cleared on edit and is required, so re-enter it to
    // allow the form to submit.
    await user.type(screen.getByLabelText(/^client secret$/i), "rotated-secret");
    await user.click(screen.getByRole("button", { name: /save connector/i }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/credentials/oauth-connectors/connector-1",
        expect.objectContaining({
          method: "PUT",
          body: expect.stringContaining('"name":"GitHub Enterprise"'),
        }),
      ),
    );
    // The rotated secret is sent to the admin endpoint, never exposed elsewhere.
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/admin/credentials/oauth-connectors/connector-1",
      expect.objectContaining({ body: expect.stringContaining("rotated-secret") }),
    );
  });

  it("deletes a connector after confirmation", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(<OAuthConnectorAdminPanel />);

    await screen.findByText("GitHub");
    await user.click(screen.getByRole("button", { name: /^delete github$/i }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/credentials/oauth-connectors/connector-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    expect(confirmSpy).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
