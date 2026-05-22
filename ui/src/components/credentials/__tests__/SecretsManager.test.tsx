import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SecretsManager } from "../SecretsManager";

describe("SecretsManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async (url, init) => {
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

      if (init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: "secret-2",
              name: "New token",
              type: "bearer_token",
              maskedPreview: "new_...alue",
              sharedWithTeams: [],
            },
          }),
        } as Response;
      }

      if (init?.method === "DELETE") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: { id: "secret-1", deleted: true },
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              id: "secret-1",
              name: "GitHub token",
              type: "bearer_token",
              maskedPreview: "ghp_...abcd",
              sharedWithTeams: ["platform-team"],
            },
          ],
        }),
      } as Response;
    }) as jest.Mock;
  });

  it("renders masked secrets and never displays raw credential values", async () => {
    render(<SecretsManager />);

    expect(await screen.findByText("GitHub token")).toBeInTheDocument();
    expect(screen.getByText("ghp_...abcd")).toBeInTheDocument();
    expect(screen.queryByText("ghp_raw_token_value")).not.toBeInTheDocument();
  });

  it("submits raw values only to the create endpoint and clears the input", async () => {
    const user = userEvent.setup();
    render(<SecretsManager />);

    await screen.findByText("GitHub token");
    expect(screen.queryByLabelText(/secret value/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /add secret/i }));
    await user.type(screen.getByLabelText(/name/i), "New token");
    await user.type(screen.getByLabelText(/secret value/i), "new-token-value");
    await user.click(screen.getByRole("button", { name: /save secret/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/credentials/secrets",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining("new-token-value"),
        }),
      );
    });
    expect(screen.queryByLabelText(/secret value/i)).not.toBeInTheDocument();
  });

  it("keeps team sharing behind a compact share icon", async () => {
    const user = userEvent.setup();
    render(<SecretsManager />);

    expect(await screen.findByText("GitHub token")).toBeInTheDocument();
    expect(screen.queryByLabelText(/team/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /share github token/i }));

    const dialog = await screen.findByRole("dialog", { name: /share github token/i });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveClass("items-center");
    expect(dialog).toHaveClass("justify-center");
    expect(await screen.findByLabelText(/team/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^share$/i }).closest("form")).toHaveClass("space-y-6");
    expect(screen.getByText("Shared with platform-team")).toBeInTheDocument();
  });

  it("deletes a secret after inline row confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = jest.spyOn(window, "confirm");
    render(<SecretsManager />);

    expect(await screen.findByText("GitHub token")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /delete github token/i }));

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(screen.getByText(/delete github token\?/i)).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalledWith(
      "/api/credentials/secrets/secret-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    await user.click(screen.getByRole("button", { name: /confirm delete github token/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/credentials/secrets/secret-1",
        expect.objectContaining({ method: "DELETE" }),
      );
    });
    expect(screen.queryByText("GitHub token")).not.toBeInTheDocument();
  });
});
