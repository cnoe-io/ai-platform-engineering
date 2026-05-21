import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SecretsManager } from "../SecretsManager";

describe("SecretsManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn(async (url, init) => {
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
});
