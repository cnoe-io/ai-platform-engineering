import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProviderConnections } from "../ProviderConnections";

function response(data: unknown, ok = true, status = ok ? 200 : 500): Response {
  return {
    ok,
    status,
    json: async () => ({ data }),
  } as Response;
}

describe("ProviderConnections", () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes("/oauth-connectors")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: "connector-1", name: "GitHub", provider: "github", enabled: true },
              { id: "connector-2", name: "Atlassian Cloud", provider: "atlassian", enabled: true },
            ],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          data: [{ id: "conn-1", provider: "github", status: "connected" }],
        }),
      } as Response;
    }) as jest.Mock;
  });

  it("renders user provider connections without token material", async () => {
    render(<ProviderConnections />);

    await waitFor(() => expect(screen.getByText("github")).toBeInTheDocument());
    expect(screen.getAllByText("connected").length).toBeGreaterThan(0);
    expect(screen.queryByText(/access_token/i)).not.toBeInTheDocument();
  });

  it("always shows every connector with connection health and relink actions", async () => {
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes("/oauth-connectors")) {
        return {
          ok: true,
          json: async () => ({
            data: [
              { id: "connector-1", name: "GitHub", provider: "github", enabled: true },
              { id: "connector-2", name: "Atlassian", provider: "atlassian", enabled: true },
              { id: "connector-3", name: "Webex", provider: "webex", enabled: true },
            ],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          data: [
            {
              id: "conn-1",
              connectorId: "connector-2",
              provider: "atlassian",
              status: "connected",
              updatedAt: "2026-05-21T16:00:00.000Z",
              expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            },
          ],
        }),
      } as Response;
    }) as jest.Mock;

    render(<ProviderConnections />);

    expect(await screen.findByText("Atlassian")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("Webex")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /provider/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /token health/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /actions/i })).toBeInTheDocument();
    expect(screen.getByText("healthy")).toBeInTheDocument();
    expect(screen.getAllByText("Never connected").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No refresh yet").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /relink atlassian/i })).toHaveAttribute(
      "href",
      "/api/credentials/oauth/atlassian/connect",
    );
    expect(screen.getByRole("button", { name: /check atlassian profile/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /connect github/i })).toHaveAttribute(
      "href",
      "/api/credentials/oauth/github/connect",
    );
  });

  it("shows available OAuth providers with connect links when not yet connected", async () => {
    global.fetch = jest.fn(async (url) => {
      if (String(url).includes("/oauth-connectors")) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: "connector-1", name: "GitHub", provider: "github", enabled: true }],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ data: [] }),
      } as Response;
    }) as jest.Mock;

    render(<ProviderConnections />);

    await waitFor(() => expect(screen.getByText("GitHub")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /connect github/i })).toHaveAttribute(
      "href",
      "/api/credentials/oauth/github/connect",
    );
  });

  it("uses same-tab OAuth navigation so relink keeps the authenticated browser context", async () => {
    const user = userEvent.setup();
    const open = jest.spyOn(window, "open");
    const connectionResponses = [[], [{ id: "conn-1", provider: "github", status: "connected" }]];

    global.fetch = jest.fn(async (url) => {
      if (String(url).includes("/oauth-connectors")) {
        return {
          ok: true,
          json: async () => ({
            data: [{ id: "connector-1", name: "GitHub", provider: "github", enabled: true }],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ data: connectionResponses.shift() ?? connectionResponses[0] }),
      } as Response;
    }) as jest.Mock;

    render(<ProviderConnections />);

    const connectLink = await screen.findByRole("link", { name: /connect github/i });
    expect(connectLink).toHaveAttribute(
      "href",
      "/api/credentials/oauth/github/connect",
    );
    expect(connectLink).not.toHaveAttribute("target");

    connectLink.addEventListener("click", (event) => event.preventDefault());
    await user.click(connectLink);

    expect(open).not.toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "caipe.oauth.connection", status: "success", provider: "github" },
      }),
    );

    await waitFor(() => expect(screen.getAllByText("connected").length).toBeGreaterThan(0));

    open.mockRestore();
  });

  it("checks a connected provider profile and reports the result", async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (url === "/api/credentials/oauth-connectors") {
        return response([
            { id: "github-connector", provider: "github", name: "GitHub", enabled: true },
            { id: "atlassian-connector", provider: "atlassian", name: "Atlassian", enabled: true },
            { id: "webex-connector", provider: "webex", name: "Webex", enabled: true },
        ]);
      }
      if (url === "/api/credentials/connections") {
        return response([
            {
              id: "github-connection",
              connectorId: "github-connector",
              provider: "github",
              status: "connected",
              expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
              updatedAt: "2026-05-21T10:00:00.000Z",
            },
        ]);
      }
      if (url === "/api/credentials/connections/github-connection/profile") {
        return response({ ok: true, provider: "github", profile: { login: "alice" } });
      }
      return response({}, false, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ProviderConnections />);

    await userEvent.click(await screen.findByRole("button", { name: /Check GitHub Profile/i }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/credentials/connections/github-connection/profile",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByText(/GitHub profile check passed/i)).toBeInTheDocument();
    expect(screen.getByText(/alice/i)).toBeInTheDocument();
  });

  it("reports Atlassian accessible resources when the user profile endpoint is denied", async () => {
    const fetchMock = jest.fn(async (url: string) => {
      if (url === "/api/credentials/oauth-connectors") {
        return response([
          { id: "atlassian-connector", provider: "atlassian", name: "Atlassian Cloud", enabled: true },
        ]);
      }
      if (url === "/api/credentials/connections") {
        return response([
          {
            id: "atlassian-connection",
            connectorId: "atlassian-connector",
            provider: "atlassian",
            status: "connected",
            expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            updatedAt: "2026-05-21T10:00:00.000Z",
          },
        ]);
      }
      if (url === "/api/credentials/connections/atlassian-connection/profile") {
        return response({
          ok: true,
          provider: "atlassian",
          profile_check: { ok: false, status: 403, message: "forbidden" },
          accessible_resources: [{ id: "cloud-1", name: "CAIPE" }],
          diagnostics: [
            {
              id: "connection_owner",
              label: "Connection ownership",
              status: "passed",
              detail: "This connection belongs to the signed-in user.",
              action: "No action needed.",
            },
            {
              id: "token_refresh",
              label: "Token refresh",
              status: "passed",
              detail: "Atlassian accepted the refresh token.",
              action: "No action needed.",
            },
            {
              id: "provider_profile",
              label: "Atlassian user profile",
              status: "warning",
              http_status: 403,
              detail: "Atlassian denied the User Identity profile endpoint.",
              action: "Ask an Atlassian admin to verify User Identity API access, or rely on accessible resources for token validation.",
            },
            {
              id: "atlassian_accessible_resources",
              label: "Accessible Atlassian sites",
              status: "passed",
              detail: "CAIPE is accessible with read:me, read:jira-work.",
              action: "No action needed.",
            },
          ],
          next_action: "Token is valid for Atlassian resources; profile endpoint needs Atlassian app/user permission review.",
        });
      }
      return response({}, false, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ProviderConnections />);

    await userEvent.click(await screen.findByRole("button", { name: /Check Atlassian Profile/i }));

    expect(await screen.findByText(/Atlassian access check passed/i)).toBeInTheDocument();
    expect(screen.getAllByText(/CAIPE/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/profile endpoint returned HTTP 403/i)).toBeInTheDocument();
    const dialog = await screen.findByRole("dialog", { name: /Atlassian token diagnostics/i });
    expect(within(dialog).getByText("Connection ownership")).toBeInTheDocument();
    expect(within(dialog).getByText("Token refresh")).toBeInTheDocument();
    expect(within(dialog).getByText("Atlassian user profile")).toBeInTheDocument();
    expect(within(dialog).getByText(/Ask an Atlassian admin/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/Token is valid for Atlassian resources/i)).toBeInTheDocument();
  });

  it("automatically refreshes expired connected providers without exposing token material", async () => {
    const fetchMock = jest.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/credentials/oauth-connectors") {
        return response([
          { id: "atlassian-connector", provider: "atlassian", name: "Atlassian", enabled: true },
        ]);
      }
      if (url === "/api/credentials/connections") {
        return response([
          {
            id: "atlassian-connection",
            connectorId: "atlassian-connector",
            provider: "atlassian",
            status: "connected",
            expiresAt: new Date(Date.now() - 60_000).toISOString(),
            updatedAt: "2026-05-21T10:00:00.000Z",
          },
        ]);
      }
      if (url === "/api/credentials/connections/atlassian-connection/refresh") {
        expect(init).toMatchObject({ method: "POST" });
        return response({ id: "atlassian-connection", provider: "atlassian", ok: true, expires_in: 3600 });
      }
      return response({}, false, 404);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<ProviderConnections />);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/credentials/connections/atlassian-connection/refresh",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(await screen.findByText("healthy")).toBeInTheDocument();
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain("access_token");
  });
});
