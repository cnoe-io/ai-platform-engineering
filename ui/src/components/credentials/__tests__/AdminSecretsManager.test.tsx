import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdminSecretsManager } from "../AdminSecretsManager";

describe("AdminSecretsManager", () => {
  beforeEach(() => {
    global.fetch = jest.fn(async (url, init) => {
      if (init?.method === "PATCH") {
        return {
          ok: true,
          json: async () => ({
            success: true,
            data: {
              id: "secret-1",
              name: "Renamed token",
              owner: { type: "user", id: "alice-sub" },
              type: "bearer_token",
              maskedPreview: "ghp_...abcd",
            },
          }),
        } as Response;
      }
      if (String(url).includes("/secret-1")) {
        return { ok: true, json: async () => ({ success: true, data: { deleted: true } }) } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: [
            {
              id: "secret-1",
              name: "GitHub token",
              owner: { type: "user", id: "alice-sub" },
              type: "bearer_token",
              maskedPreview: "ghp_...abcd",
            },
          ],
        }),
      } as Response;
    }) as jest.Mock;
  });

  it("lists all secret metadata and deletes through admin route", async () => {
    const user = userEvent.setup();
    render(<AdminSecretsManager />);

    expect(await screen.findByText("GitHub token")).toBeInTheDocument();
    expect(screen.getByText("user:alice-sub")).toBeInTheDocument();
    expect(screen.queryByText("ghp_raw_token_value")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /edit/i }));
    await user.clear(screen.getByLabelText(/name/i));
    await user.type(screen.getByLabelText(/name/i), "Renamed token");
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/credentials/secrets/secret-1",
        expect.objectContaining({
          method: "PATCH",
          body: expect.stringContaining("Renamed token"),
        }),
      ),
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/admin/credentials/secrets/secret-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
});
