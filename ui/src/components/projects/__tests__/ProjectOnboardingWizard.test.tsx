/**
 * @jest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { ProjectOnboardingWizard } from "../ProjectOnboardingWizard";

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { email: "test-user@example.com" } } }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock("@/lib/config", () => ({
  getConfig: () => undefined,
}));

const jsonResponse = (data: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => data,
  } as Response);

describe("ProjectOnboardingWizard hierarchy pickers", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects/onboarding-config") {
        return jsonResponse({ data: { config: { steps: [] } } });
      }
      if (url === "/api/projects?type=bhag") {
        return jsonResponse({
          data: {
            projects: [
              { type: "bhag", slug: "example-goal", title: "Example Goal" },
            ],
          },
        });
      }
      if (url === "/api/projects?type=area&initiative=example-goal") {
        return jsonResponse({
          data: {
            projects: [
              { type: "area", slug: "example-area", title: "Example Area" },
            ],
          },
        });
      }
      if (url === "/api/dynamic-agents/teams") {
        return jsonResponse({ data: [] });
      }
      return jsonResponse({});
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("shows title-only BHAG and Area records and selects them by slug", async () => {
    render(<ProjectOnboardingWizard initialOpen />);

    await screen.findByRole("heading", { name: "Type" });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    const bhagSelect = await screen.findByLabelText(/Parent BHAG/);
    expect(within(bhagSelect).getByRole("option", { name: "Example Goal" })).toHaveValue(
      "example-goal",
    );

    fireEvent.change(bhagSelect, { target: { value: "example-goal" } });

    const areaSelect = await screen.findByLabelText(/Parent Area/);
    await waitFor(() => {
      expect(within(areaSelect).getByRole("option", { name: "Example Area" })).toHaveValue(
        "example-area",
      );
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects?type=area&initiative=example-goal",
    );
  });
});
