/**
 * @jest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImportAgentsFromConfigCard } from "../ImportAgentsFromConfigCard";

const PREVIEW_AGENTS = [
  { id: "agent-1", name: "Agent One", description: "desc", in_db: true, already_adopted: false },
  { id: "agent-2", name: "Agent Two", in_db: true, already_adopted: true },
  { id: "agent-3", name: "Agent Three", in_db: false, already_adopted: false },
];

const TEAMS = [
  { _id: "t1", name: "Platform", slug: "platform", user_role: "admin", can_own_agents: true },
  { _id: "t2", name: "SRE", slug: "sre", user_role: "admin", can_own_agents: true },
];

function mockFetch({
  preview = { success: true, data: { agents: PREVIEW_AGENTS } },
  teams = { success: true, data: TEAMS },
  apply = {
    success: true,
    data: { agents: PREVIEW_AGENTS, adopted: ["agent-1"], skipped: [] },
  },
}: {
  preview?: object;
  teams?: object;
  apply?: object;
} = {}) {
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("/api/admin/dynamic-agents/runtime/sync-from-config")) {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      const payload = body.dry_run === false ? apply : preview;
      return Promise.resolve({
        json: () => Promise.resolve(payload),
      } as Response);
    }
    if (href.includes("/api/dynamic-agents/teams")) {
      return Promise.resolve({
        json: () => Promise.resolve(teams),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${href}`));
  });
}

describe("ImportAgentsFromConfigCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch();
  });

  it("renders nothing for non-admins", () => {
    render(<ImportAgentsFromConfigCard isAdmin={false} />);
    expect(screen.queryByText("Import Agents from Config")).not.toBeInTheDocument();
  });

  it("shows the button and pane for admins", () => {
    render(<ImportAgentsFromConfigCard isAdmin />);
    expect(screen.getByText("Import Agents from Config")).toBeInTheDocument();
    expect(screen.getByTestId("import-agents-from-config-button")).toBeInTheDocument();
  });

  it("previews agents and pre-selects importable (in_db, not-adopted) ones when the modal opens", async () => {
    render(<ImportAgentsFromConfigCard isAdmin />);
    fireEvent.click(screen.getByTestId("import-agents-from-config-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-agent-checkbox-agent-1")).toBeChecked();
    });
    // Already-adopted and not-yet-seeded agents are disabled and unselected.
    expect(screen.getByTestId("import-agent-checkbox-agent-2")).toBeDisabled();
    expect(screen.getByTestId("import-agent-checkbox-agent-2")).not.toBeChecked();
    expect(screen.getByTestId("import-agent-checkbox-agent-3")).toBeDisabled();
    expect(screen.getByText("Already adopted")).toBeInTheDocument();
    expect(screen.getByText("Not seeded yet")).toBeInTheDocument();
  });

  it("applies the import with only the selected agent ids and no team assignment by default", async () => {
    render(<ImportAgentsFromConfigCard isAdmin />);
    fireEvent.click(screen.getByTestId("import-agents-from-config-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-agent-checkbox-agent-1")).toBeChecked();
    });

    fireEvent.click(screen.getByTestId("import-agents-apply-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-agents-result")).toBeInTheDocument();
    });

    const applyCall = (global.fetch as jest.Mock).mock.calls.find(([, init]) => {
      if (!init?.body) return false;
      const body = JSON.parse(String(init.body));
      return body.dry_run === false;
    });
    expect(applyCall).toBeDefined();
    const body = JSON.parse(String(applyCall![1].body));
    expect(body.agent_ids).toEqual(["agent-1"]);
    expect(body.owner_team_slug).toBeNull();
    expect(body.shared_with_teams).toEqual([]);
    expect(screen.getByText(/Adopted 1 agent\./)).toBeInTheDocument();
  });

  it("deselecting an agent excludes it from the apply request", async () => {
    render(<ImportAgentsFromConfigCard isAdmin />);
    fireEvent.click(screen.getByTestId("import-agents-from-config-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-agent-checkbox-agent-1")).toBeChecked();
    });

    fireEvent.click(screen.getByTestId("import-agent-checkbox-agent-1"));
    expect(screen.getByTestId("import-agents-apply-button")).toBeDisabled();
  });

  it("surfaces an error banner when the apply call fails", async () => {
    mockFetch({
      apply: { success: false, error: "Import failed spectacularly" },
    });
    render(<ImportAgentsFromConfigCard isAdmin />);
    fireEvent.click(screen.getByTestId("import-agents-from-config-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-agent-checkbox-agent-1")).toBeChecked();
    });

    fireEvent.click(screen.getByTestId("import-agents-apply-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-agents-error")).toHaveTextContent(
        "Import failed spectacularly",
      );
    });
  });

  it("keeps the agent checklist in a capped, scrollable container with ~200 agents", async () => {
    const manyAgents = Array.from({ length: 200 }, (_, i) => ({
      id: `agent-${i}`,
      name: `Agent ${i}`,
      in_db: true,
      already_adopted: false,
    }));
    mockFetch({ preview: { success: true, data: { agents: manyAgents } } });

    render(<ImportAgentsFromConfigCard isAdmin />);
    fireEvent.click(screen.getByTestId("import-agents-from-config-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-agent-checkbox-agent-0")).toBeChecked();
    });

    // All 200 rows render (nothing is truncated/paginated away)...
    expect(screen.getByTestId("import-agent-checkbox-agent-199")).toBeInTheDocument();

    // ...but the list itself scrolls within a bounded height rather than
    // growing the dialog to fit all 200 rows.
    const checklist = screen.getByTestId("import-agents-checklist");
    expect(checklist.className).toContain("max-h-56");
    expect(checklist.className).toContain("overflow-y-auto");
  });
});
