import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProviderConnections } from "../ProviderConnections";

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
    expect(screen.getByText("connected")).toBeInTheDocument();
    expect(screen.queryByText(/access_token/i)).not.toBeInTheDocument();
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

  it("opens OAuth connect in a popup and refreshes after callback completion", async () => {
    const user = userEvent.setup();
    const popup = { focus: jest.fn(), location: { href: "" }, opener: window };
    const open = jest.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
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

    await user.click(await screen.findByRole("link", { name: /connect github/i }));

    expect(open).toHaveBeenCalledWith(
      "",
      "caipe-oauth-github",
      expect.stringContaining("popup=yes"),
    );
    expect(popup.opener).toBeNull();
    expect(popup.location.href).toBe("/api/credentials/oauth/github/connect");
    expect(popup.focus).toHaveBeenCalled();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: { type: "caipe.oauth.connection", status: "success", provider: "github" },
      }),
    );

    await waitFor(() => expect(screen.getByText("connected")).toBeInTheDocument());

    open.mockRestore();
  });
});
