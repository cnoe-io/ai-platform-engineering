import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { RepoOnboardingWizard } from "@/components/agentic-sdlc/RepoOnboardingWizard";

describe("RepoOnboardingWizard", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: async () => ({
        item: {
          repo_id: "123456",
          full_name: "acme/real-repo",
          webhook_id: 987,
          webhook_url:
            "https://demo.ngrok-free.app/api/agentic-sdlc/webhooks/github",
          webhook_events: ["issues", "pull_request"],
        },
      }),
    }) as jest.Mock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("submits a real GitHub repo onboarding request", async () => {
    const user = userEvent.setup();
    render(<RepoOnboardingWizard />);

    await user.click(
      screen.getByRole("button", { name: /open repo onboarding wizard/i }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/step 1 of 4/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /project/i })).not.toBeInTheDocument();

    await user.type(
      screen.getByRole("textbox", { name: /^repository$/i }),
      "acme/real-repo",
    );
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByText(/step 2 of 4/i)).toBeInTheDocument();
    expect(
      screen.getByText("https://github-webhook.eticloud.io/github"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("http://localhost:3000/api/agentic-sdlc/webhooks/github"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByText(/step 3 of 4/i)).toBeInTheDocument();
    expect(screen.getByText("agent:awaiting-review")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByText(/step 4 of 4/i)).toBeInTheDocument();
    await user.clear(
      screen.getByRole("textbox", { name: /github webhook payload url/i }),
    );
    await user.type(
      screen.getByRole("textbox", { name: /github webhook payload url/i }),
      "https://github-webhook.eticloud.io/github",
    );
    await user.type(
      screen.getByRole("textbox", { name: /webhook secret/i }),
      "local-secret",
    );

    await user.click(screen.getByRole("button", { name: /connect repo/i }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/agentic-sdlc/repos",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: "acme",
            repo: "real-repo",
            callback_url: "https://github-webhook.eticloud.io/github",
            webhook_secret: "local-secret",
            sandbox_environment: "sandbox-eks",
          }),
        }),
      ),
    );

    expect(
      await screen.findByText(/connected acme\/real-repo/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/webhook #987/i)).toBeInTheDocument();
    expect(screen.getByText(/back to repos/i)).toBeInTheDocument();
    expect(screen.queryByText(/see all projects/i)).not.toBeInTheDocument();
  });
});
