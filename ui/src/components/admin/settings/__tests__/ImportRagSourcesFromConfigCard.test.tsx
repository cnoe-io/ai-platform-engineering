/**
 * @jest-environment jsdom
 */

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImportRagSourcesFromConfigCard } from "../ImportRagSourcesFromConfigCard";

const PREVIEW_SOURCES = [
  {
    source_id: "slack-channel-C1",
    name: "eng-general",
    source_type: "slack_channel",
    in_db: true,
    already_adopted: false,
    importable: false,
  },
  {
    source_id: "slack-channel-C2",
    name: "eng-random",
    source_type: "slack_channel",
    in_db: true,
    already_adopted: true,
    importable: false,
  },
  {
    source_id: "slack-channel-C3",
    name: "eng-support",
    source_type: "slack_channel",
    in_db: false,
    already_adopted: false,
    importable: true,
  },
];

const TEAMS = [
  { _id: "t1", name: "Platform", slug: "platform", user_role: "admin", can_own_agents: true },
  { _id: "t2", name: "SRE", slug: "sre", user_role: "admin", can_own_agents: true },
];

function mockFetch({
  preview = { success: true, data: { sources: PREVIEW_SOURCES } },
  teams = { success: true, data: TEAMS },
  apply = {
    success: true,
    data: { sources: PREVIEW_SOURCES, adopted: ["slack-channel-C1"], skipped: [] },
  },
}: {
  preview?: object;
  teams?: object;
  apply?: object;
} = {}) {
  global.fetch = jest.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const href = String(url);
    if (href.includes("/api/admin/rag/sources/migrate-from-config")) {
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
    if (href.includes("/api/admin/platform-config")) {
      return Promise.resolve({
        json: () => Promise.resolve({
          success: true,
          data: { rag_default_search_team_slug: null },
        }),
      } as Response);
    }
    return Promise.reject(new Error(`Unexpected fetch: ${href}`));
  });
}

function selectMigrationTeams() {
  fireEvent.click(screen.getByRole("combobox", { name: /Owner team/i }));
  fireEvent.click(screen.getByRole("option", { name: /Platform/i }));
  fireEvent.click(screen.getByRole("combobox", { name: /Platform RAG Search team/i }));
  fireEvent.click(screen.getByRole("option", { name: /SRE/i }));
}

describe("ImportRagSourcesFromConfigCard", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch();
  });

  it("renders nothing for non-admins", () => {
    render(<ImportRagSourcesFromConfigCard isAdmin={false} />);
    expect(screen.queryByText("Migrate Ingested RAG Sources")).not.toBeInTheDocument();
  });

  it("shows the button and pane for admins", () => {
    render(<ImportRagSourcesFromConfigCard isAdmin />);
    expect(screen.getByText("Migrate Ingested RAG Sources")).toBeInTheDocument();
    expect(screen.getByTestId("import-rag-sources-from-config-button")).toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("previews sources and pre-selects importable (not-yet-in-db) ones when the modal opens", async () => {
    render(<ImportRagSourcesFromConfigCard isAdmin />);
    fireEvent.click(screen.getByTestId("import-rag-sources-from-config-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-rag-source-checkbox-slack-channel-C3")).toBeChecked();
    });
    // Sources that already have a config row (adopted or not) are disabled and unselected.
    expect(screen.getByTestId("import-rag-source-checkbox-slack-channel-C1")).toBeDisabled();
    expect(screen.getByTestId("import-rag-source-checkbox-slack-channel-C1")).not.toBeChecked();
    expect(screen.getByTestId("import-rag-source-checkbox-slack-channel-C2")).toBeDisabled();
    expect(screen.getByText("Already adopted")).toBeInTheDocument();
    expect(screen.getByText("Has config row")).toBeInTheDocument();
  });

  it("applies only the selected source ids with independent Owner and Search teams", async () => {
    render(<ImportRagSourcesFromConfigCard isAdmin />);
    fireEvent.click(screen.getByTestId("import-rag-sources-from-config-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-rag-source-checkbox-slack-channel-C3")).toBeChecked();
    });

    selectMigrationTeams();
    fireEvent.click(screen.getByTestId("import-rag-sources-apply-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-rag-sources-result")).toBeInTheDocument();
    });

    const applyCall = (global.fetch as jest.Mock).mock.calls.find(([, init]) => {
      if (!init?.body) return false;
      const body = JSON.parse(String(init.body));
      return body.dry_run === false;
    });
    expect(applyCall).toBeDefined();
    const body = JSON.parse(String(applyCall![1].body));
    expect(body.source_ids).toEqual(["slack-channel-C3"]);
    expect(body.management_team_slug).toBe("platform");
    expect(body.search_team_slug).toBe("sre");
    expect(screen.getByTestId("import-rag-sources-result")).toHaveTextContent(
      "Adopted 1 editable connector.",
    );
  });

  it("deselecting a source excludes it from the apply request", async () => {
    render(<ImportRagSourcesFromConfigCard isAdmin />);
    fireEvent.click(screen.getByTestId("import-rag-sources-from-config-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-rag-source-checkbox-slack-channel-C3")).toBeChecked();
    });

    fireEvent.click(screen.getByTestId("import-rag-source-checkbox-slack-channel-C3"));
    expect(screen.getByTestId("import-rag-sources-apply-button")).toBeDisabled();
  });

  it("surfaces an error banner when the apply call fails", async () => {
    mockFetch({
      apply: { success: false, error: "Import failed spectacularly" },
    });
    render(<ImportRagSourcesFromConfigCard isAdmin />);
    fireEvent.click(screen.getByTestId("import-rag-sources-from-config-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-rag-source-checkbox-slack-channel-C3")).toBeChecked();
    });

    selectMigrationTeams();
    fireEvent.click(screen.getByTestId("import-rag-sources-apply-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-rag-sources-error")).toHaveTextContent(
        "Import failed spectacularly",
      );
    });
  });

  it("renders per-source skip reasons in the result banner", async () => {
    mockFetch({
      apply: {
        success: true,
        data: {
          sources: PREVIEW_SOURCES,
          adopted: [],
          skipped: [
            { source_id: "slack-channel-C3", reason: "already_in_db" },
          ],
        },
      },
    });
    render(<ImportRagSourcesFromConfigCard isAdmin />);
    fireEvent.click(screen.getByTestId("import-rag-sources-from-config-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-rag-source-checkbox-slack-channel-C3")).toBeChecked();
    });

    selectMigrationTeams();
    fireEvent.click(screen.getByTestId("import-rag-sources-apply-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-rag-sources-result")).toHaveTextContent(
        "slack-channel-C3: already has a config row",
      );
    });
  });

  it("keeps the source checklist in a capped, scrollable container with ~200 sources", async () => {
    const manySources = Array.from({ length: 200 }, (_, i) => ({
      source_id: `slack-channel-${i}`,
      name: `channel-${i}`,
      source_type: "slack_channel",
      in_db: false,
      already_adopted: false,
      importable: true,
    }));
    mockFetch({ preview: { success: true, data: { sources: manySources } } });

    render(<ImportRagSourcesFromConfigCard isAdmin />);
    fireEvent.click(screen.getByTestId("import-rag-sources-from-config-button"));

    await waitFor(() => {
      expect(screen.getByTestId("import-rag-source-checkbox-slack-channel-0")).toBeChecked();
    });

    // All 200 rows render (nothing is truncated/paginated away)...
    expect(screen.getByTestId("import-rag-source-checkbox-slack-channel-199")).toBeInTheDocument();

    // ...but the list itself scrolls within a bounded height rather than
    // growing the dialog to fit all 200 rows.
    const checklist = screen.getByTestId("import-rag-sources-checklist");
    expect(checklist.className).toContain("max-h-56");
    expect(checklist.className).toContain("overflow-y-auto");
  });
});
