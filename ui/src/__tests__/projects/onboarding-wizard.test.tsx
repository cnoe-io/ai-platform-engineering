import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ProjectOnboardingWizard } from "@/components/projects/ProjectOnboardingWizard";

describe("ProjectOnboardingWizard", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/api/dynamic-agents/teams")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: [{ _id: "team-1", name: "Platform Team", slug: "platform-team" }],
          }),
        }) as Promise<Response>;
      }

      if (url.includes("/api/projects/onboarding-config")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              config: {
                hero: { title: "Projects", description: "Test" },
                steps: [],
              },
            },
          }),
        }) as Promise<Response>;
      }

      if (url.includes("/api/projects/onboard")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            data: {
              project: {
                _id: "proj-1",
                slug: "ai-memory",
                title: "AI Memory Revamp",
                team_name: "Platform Team",
                status: "onboarding",
                onboarding: {},
                integrations: {},
              },
            },
          }),
        }) as Promise<Response>;
      }

      if (url.includes("/api/projects") && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          status: 201,
          json: async () => ({
            data: {
              project: {
                _id: "proj-1",
                slug: "ai-memory",
                title: "AI Memory Revamp",
                team_name: "Platform Team",
                status: "draft",
                onboarding: {},
                integrations: {},
              },
            },
          }),
        }) as Promise<Response>;
      }

      return Promise.resolve({
        ok: true,
        json: async () => ({ data: {} }),
      }) as Promise<Response>;
    }) as jest.Mock;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("opens wizard and submits project creation", async () => {
    const user = userEvent.setup();
    render(<ProjectOnboardingWizard />);

    await user.click(screen.getByRole("button", { name: /launch project onboarding/i }));
    expect(screen.getByRole("heading", { name: /create project/i })).toBeInTheDocument();

    await user.type(
      screen.getByPlaceholderText("My Platform Initiative"),
      "AI Memory Revamp",
    );

    await user.click(screen.getByRole("button", { name: /select owning team/i }));
    await user.click(screen.getByRole("option", { name: /platform team/i }));

    await user.click(screen.getByRole("button", { name: /create & continue/i }));

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/projects",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });
});
