/**
 * @jest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { ProjectSettingsPanel } from "../ProjectSettingsPanel";
import { ToastProvider } from "@/components/ui/toast";
import { useUnsavedChangesStore } from "@/store/unsaved-changes-store";

jest.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { email: "test-user@example.com" } } }),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const mockUseProjectSourceKinds = jest.fn(() => ({
  kinds: [] as Array<"github" | "confluence" | "webex">,
  loading: false,
}));

jest.mock("@/components/projects/source-pickers/useProjectSourceKinds", () => ({
  useProjectSourceKinds: () => mockUseProjectSourceKinds(),
}));

const jsonResponse = (data: unknown, ok = true) =>
  Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: async () => data,
  } as Response);

const renderSettings = (props: React.ComponentProps<typeof ProjectSettingsPanel>) =>
  render(
    <ToastProvider>
      <ProjectSettingsPanel {...props} />
    </ToastProvider>,
  );

describe("ProjectSettingsPanel hierarchy hydration", () => {
  beforeEach(() => {
    useUnsavedChangesStore.setState({
      hasUnsavedChanges: false,
      pendingNavigationHref: null,
      pendingDeferredAction: null,
    });
    mockUseProjectSourceKinds.mockReturnValue({ kinds: [], loading: false });
    (global.fetch as jest.Mock).mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/projects/example-project" && init?.method === "PATCH") {
        const payload = JSON.parse(String(init.body)) as { title: string; description: string };
        return jsonResponse({
          data: {
            project: {
              type: "project",
              slug: "example-project",
              name: "Example Project",
              title: payload.title,
              description: payload.description,
              team_id: "example-team-id",
              team_slug: "example-team",
              team_name: "Example Team",
              labels: { areas: ["example-area"], initiatives: ["example-bhag"] },
              sources: { repos: [], confluence_url: "" },
              data_steward: { type: "user", id: "test-user@example.com" },
            },
          },
        });
      }

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
              labels: { areas: ["example-area"], initiatives: [] },
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
              { type: "bhag", slug: "example-bhag", title: "Example BHAG" },
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
                title: "Example Area",
                labels: { initiatives: ["example-bhag"] },
              },
            ],
          },
        });
      }

      if (url === "/api/projects?type=area&initiative=example-bhag") {
        return jsonResponse({
          data: {
            projects: [
              { type: "area", slug: "example-area", title: "Example Area" },
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
    useUnsavedChangesStore.getState().cancelNavigation();
    useUnsavedChangesStore.getState().setUnsaved(false);
  });

  it("restores a saved Area and its parent BHAG when settings reopen", async () => {
    renderSettings({ slug: "example-project" });

    expect(await screen.findByText("Project settings")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Access Config" }), {
      button: 0,
      ctrlKey: false,
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Example BHAG")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Example Area")).toBeInTheDocument();
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/projects?type=area");
    expect(global.fetch).toHaveBeenCalledWith(
      "/api/projects?type=area&initiative=example-bhag",
    );
  });

  it("offers Stay or Discard when navigation would lose changed settings", async () => {
    renderSettings({ slug: "example-project" });

    const title = await screen.findByDisplayValue("Example Project");
    await waitFor(() => {
      expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(false);
    });

    fireEvent.change(title, { target: { value: "Changed title" } });
    await waitFor(() => {
      expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(true);
    });

    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);

    const navigate = jest.fn();
    useUnsavedChangesStore.getState().requestDeferredAction(navigate);
    expect(await screen.findByText("Discard unsaved settings?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Stay" }));
    expect(navigate).not.toHaveBeenCalled();
    expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(true);

    useUnsavedChangesStore.getState().requestDeferredAction(navigate);
    fireEvent.click(await screen.findByRole("button", { name: "Discard and leave" }));

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(false);
  });

  it("clears the navigation guard after settings save successfully", async () => {
    renderSettings({ slug: "example-project" });

    fireEvent.change(await screen.findByDisplayValue("Example Project"), {
      target: { value: "Saved title" },
    });
    await waitFor(() => {
      expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(true);
    });

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("Saved title")).toBeInTheDocument();
      expect(useUnsavedChangesStore.getState().hasUnsavedChanges).toBe(false);
    });
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(false);
  });

  it("keeps a project's own direct BHAG tag even when its tagged Area has no BHAG of its own", async () => {
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
              // Tagged directly to both a BHAG and an Area, independently —
              // not an error state. The Area below is NOT itself tagged to
              // this (or any) BHAG in its own labels.
              labels: { areas: ["untagged-area"], initiatives: ["direct-bhag"] },
              sources: { repos: [], confluence_url: "" },
              data_steward: { type: "user", id: "test-user@example.com" },
            },
            permissions: { can_edit: true, can_manage_steward: true },
          },
        });
      }

      if (url === "/api/projects?type=bhag") {
        return jsonResponse({
          data: { projects: [{ type: "bhag", slug: "direct-bhag", title: "Direct BHAG" }] },
        });
      }

      if (url === "/api/projects?type=area") {
        return jsonResponse({
          data: {
            projects: [
              {
                type: "area",
                slug: "untagged-area",
                title: "Untagged Area",
                labels: { initiatives: [] },
              },
            ],
          },
        });
      }

      if (url === "/api/projects?type=area&initiative=direct-bhag") {
        return jsonResponse({ data: { projects: [] } });
      }

      if (url === "/api/projects/untagged-area") {
        return jsonResponse({
          data: { project: { type: "area", slug: "untagged-area", title: "Untagged Area" } },
        });
      }

      if (url === "/api/dynamic-agents/teams") {
        return jsonResponse({
          data: [{ _id: "example-team-id", slug: "example-team", name: "Example Team" }],
        });
      }

      if (url === "/api/tome/projects/example-project/feed-status") {
        return jsonResponse({ data: null });
      }

      return jsonResponse({});
    });

    renderSettings({ slug: "example-project" });

    expect(await screen.findByText("Project settings")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Access Config" }), {
      button: 0,
      ctrlKey: false,
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Direct BHAG")).toBeInTheDocument();
      expect(screen.getByDisplayValue("Untagged Area")).toBeInTheDocument();
    });
  });

  it("makes attached-source ingestion discoverable for an Area", async () => {
    mockUseProjectSourceKinds.mockReturnValue({
      kinds: ["github"],
      loading: false,
    });
    const fallback = (global.fetch as jest.Mock).getMockImplementation();
    (global.fetch as jest.Mock).mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === "/api/projects/example-project") {
          return jsonResponse({
            data: {
              project: {
                type: "area",
                slug: "example-project",
                name: "Example Area",
                title: "Example Area",
                description: "Example description",
                team_id: "example-team-id",
                team_slug: "example-team",
                team_name: "Example Team",
                labels: { areas: [], initiatives: [] },
                sources: {
                  repos: ["https://github.com/example/repository"],
                },
                data_steward: { type: "user", id: "test-user" },
              },
              permissions: { can_edit: true, can_manage_steward: true },
            },
          });
        }
        return fallback?.(input, init) ?? jsonResponse({});
      },
    );
    const onOpenIngest = jest.fn();

    renderSettings({ slug: "example-project", onOpenIngest });
    expect(await screen.findByText("Area settings")).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Sources" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Ingest & synthesize" }),
    );

    expect(onOpenIngest).toHaveBeenCalledTimes(1);
  });
});
