import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// assisted-by Codex Codex-sonnet-4-6

// DynamicAgentEditor pulls in react-markdown/react-syntax-highlighter, which
// is unrelated to search/pagination and breaks jsdom module transforms.
jest.mock("../DynamicAgentEditor", () => ({
  DynamicAgentEditor: () => <div data-testid="dynamic-agent-editor" />,
}));

import { DynamicAgentsTab } from "../DynamicAgentsTab";
import type { DynamicAgentConfigWithPermissions } from "@/types/dynamic-agent";

function makeAgent(overrides: Partial<DynamicAgentConfigWithPermissions> = {}): DynamicAgentConfigWithPermissions {
  return {
    _id: "agent-1",
    name: "Ops Helper",
    description: "Helps with ops",
    system_prompt: "You help.",
    allowed_tools: {},
    model: { id: "gpt-4o", provider: "openai" },
    visibility: "team",
    owner_team_slug: "platform",
    owner_team_id: "team-1",
    shared_with_teams: [],
    subagents: [],
    skills: [],
    ui: { gradient_theme: "default" },
    enabled: true,
    owner_id: "user-1",
    is_system: false,
    created_at: "2026-05-01T00:00:00Z",
    updated_at: "2026-05-01T00:00:00Z",
    permissions: { can_manage: true, can_write: true, can_discover: true },
    ...overrides,
  } as DynamicAgentConfigWithPermissions;
}

function jsonResponse(body: unknown) {
  return {
    json: async () => body,
  } as Response;
}

describe("DynamicAgentsTab search + pagination", () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    fetchMock = jest.fn(() => {
      return Promise.resolve(
        jsonResponse({
          success: true,
          data: { items: [makeAgent()], total: 1 },
        }),
      );
    });
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("fetches agents on mount with default page and page_size params", async () => {
    render(<DynamicAgentsTab />);

    await act(async () => {
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/dynamic-agents?page=1&page_size=20");
    });
  });

  it("debounces search input and calls fetch with the search param after 300ms", async () => {
    render(<DynamicAgentsTab />);

    await act(async () => {
      await Promise.resolve();
    });

    fetchMock.mockClear();

    fireEvent.change(screen.getByPlaceholderText("Search by name or ID..."), {
      target: { value: "ops" },
    });

    // Not yet fired before debounce elapses.
    await act(async () => {
      jest.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(150);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/dynamic-agents?page=1&page_size=20&search=ops");
    });
  });

  it("resets to page 1 when the search changes while on a later page", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          success: true,
          data: { items: [makeAgent()], total: 100 },
        }),
      ),
    );

    render(<DynamicAgentsTab />);

    await act(async () => {
      await Promise.resolve();
    });

    // Move to page 2 via the page button.
    fireEvent.click(screen.getByText("2"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/dynamic-agents?page=2&page_size=20");
    });

    fetchMock.mockClear();

    fireEvent.change(screen.getByPlaceholderText("Search by name or ID..."), {
      target: { value: "ops" },
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/dynamic-agents?page=1&page_size=20&search=ops");
    });
  });

  it("calls fetch with the updated page when a page button is clicked", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          success: true,
          data: { items: [makeAgent()], total: 100 },
        }),
      ),
    );

    render(<DynamicAgentsTab />);

    await act(async () => {
      await Promise.resolve();
    });

    fetchMock.mockClear();
    fireEvent.click(screen.getByText("2"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/dynamic-agents?page=2&page_size=20");
    });
  });

  it("calls fetch with the updated page_size and resets to page 1 when rows-per-page changes", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          success: true,
          data: { items: [makeAgent()], total: 100 },
        }),
      ),
    );

    render(<DynamicAgentsTab />);

    await act(async () => {
      await Promise.resolve();
    });

    // Move to page 2 first so we can assert the reset-to-1 behavior.
    fireEvent.click(screen.getByText("2"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith("/api/dynamic-agents?page=2&page_size=20");
    });
    const pageSizeSelect = await screen.findByRole("combobox");

    fetchMock.mockClear();

    fireEvent.change(pageSizeSelect, { target: { value: "50" } });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/dynamic-agents?page=1&page_size=50");
    });
  });

  it("shows the no-results empty state for a search term, and Clear search resets search + refetches", async () => {
    fetchMock.mockImplementation((url: string) => {
      const isSearching = url.includes("search=zzz-no-match");
      return Promise.resolve(
        jsonResponse({
          success: true,
          data: {
            items: isSearching ? [] : [makeAgent()],
            total: isSearching ? 0 : 1,
          },
        }),
      );
    });

    render(<DynamicAgentsTab />);

    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.change(screen.getByPlaceholderText("Search by name or ID..."), {
      target: { value: "zzz-no-match" },
    });

    await act(async () => {
      jest.advanceTimersByTime(300);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith(
        "/api/dynamic-agents?page=1&page_size=20&search=zzz-no-match",
      );
    });

    expect(await screen.findByText('No agents match "zzz-no-match"')).toBeInTheDocument();
    const clearButton = screen.getByRole("button", { name: "Clear search" });

    fetchMock.mockClear();
    fireEvent.click(clearButton);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByPlaceholderText("Search by name or ID...")).toHaveValue("");
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/dynamic-agents?page=1&page_size=20");
    });
    await screen.findByText("Ops Helper");
  });
});
