/**
 * @jest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ProjectSettingsPanel } from "../ProjectSettingsPanel";

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { email: "test-user@example.com" } } }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/components/projects/source-pickers/useProjectSourceKinds", () => ({
  useProjectSourceKinds: () => ({ kinds: [], loading: false }),
}));

const jsonResponse = (data: unknown, ok = true) =>
  Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  } as Response);

describe("ProjectSettingsPanel hierarchy hydration", () => {
  beforeEach(() => {
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);

      if (url === "/api/projects/example-project") {
        return jsonResponse({
          data: {
            project: {
              type: "project",
              slug: "example-project",
              name: "Example Project",
              title: "Example Project",
              description: "Example description",
              team_id: "example-team-id",
              team_slug: "example-team",
              team_name: "Example Team",
              labels: { areas: ["Example Area"], initiatives: [] },
              sources: { repos: [], confluence_url: "" },
              data_steward: { type: "user", id: "test-user@example.com" },
            },
            permissions: { can_edit: true, can_manage_steward: true },
          },
        });
      }

      if (url === "/api/projects?type=bhag") {
        return jsonResponse({
          data: {
            projects: [
              { type: "bhag", slug: "example-bhag", name: "Example BHAG" },
            ],
          },
        });
      }

      if (url === "/api/projects?type=area") {
        return jsonResponse({
          data: {
            projects: [
              {
                type: "area",
                slug: "example-area",
                name: "Example Area",
                labels: { initiatives: ["Example BHAG"] },
              },
            ],
          },
        });
      }

      if (url === "/api/projects?type=area&initiative=Example%20BHAG") {
        return jsonResponse({
          data: {
            projects: [
              { type: "area", slug: "example-area", name: "Example Area" },
            ],
          },
        });
      }

      if (url === "/api/dynamic-agents/teams") {
        return jsonResponse({
          data: [
            {
              _id: "example-team-id",
              slug: "example-team",
              name: "Example Team",
            },
          ],
        });
      }

      if (url === "/api/tome/projects/example-project/feed-status") {
        return jsonResponse({ data: null });
      }

      return jsonResponse({});
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it("restores a saved Area and its parent BHAG when settings reopen", async () => {
    render(<ProjectSettingsPanel slug="example-project" />);

    expect(await screen.findByText("Project settings")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Organization" }), {
      button: 0,
      ctrlKey: false,
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Example BHAG")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Example Area")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/projects?type=area");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects?type=area&initiative=Example%20BHAG",
    );
  });
});
