import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockToast = jest.fn();
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { WebexSpaceRebacPanel } from "../WebexSpaceRebacPanel";
import { pickTeam } from "@/__test-utils__/team-picker";
import { pickAgent } from "@/__test-utils__/agent-picker";

const fetchMock = jest.fn();

function setupFetchMock() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/webex/spaces" || url === "/api/admin/webex/spaces?health=1") {
      return response({
        data: {
          spaces: [
            { workspace_id: "WEBEX-WORKSPACE", space_id: "space-abc", space_name: "Platform Alerts", active_grants: 0 },
          ],
        },
      });
    }
    if (String(url).startsWith("/api/admin/webex/available-spaces")) {
      return response({
        data: {
          spaces: [
            { id: "space-abc", name: "Platform Alerts", type: "group", is_locked: false },
            { id: "space-new-123", name: "Incident War Room", type: "group", is_locked: false },
          ],
          has_more: false,
          next_cursor: null,
        },
      });
    }
    if (url === "/api/dynamic-agents?enabled_only=true") {
      return response({
        data: {
          items: [
            { _id: "test-april-2025", name: "Test April 2025" },
            { _id: "incident-agent", name: "Incident Agent" },
          ],
        },
      });
    }
    if (url === "/api/admin/teams") {
      return response({
        data: { teams: [{ _id: "team-1", slug: "platform-engineering", name: "Platform Engineering" }] },
      });
    }
    if (url === "/api/admin/webex/spaces/defaults" && init?.method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}"));
      return response({
        data: {
          summary: {
            spaces_seen: body.manual_spaces?.length ?? 1,
            spaces_assigned_team: body.manual_spaces?.length ?? 1,
            space_grants_ensured: body.manual_spaces?.length ?? 1,
            routes_ensured: body.manual_spaces?.length ?? 1,
            spaces_manual: body.manual_spaces?.length ?? 0,
            spaces_onboarded: body.manual_spaces?.length ?? 0,
            routes_preserved: 0,
          },
        },
      });
    }
    if (url === "/api/admin/webex/spaces/defaults" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body ?? "{}"));
      return response({
        data: {
          defaults: { ...body, source: "db", updated_at: "2026-05-27T08:00:00.000Z", updated_by: "admin@example.com" },
        },
      });
    }
    if (url === "/api/admin/webex/spaces/defaults") {
      return response({
        data: { defaults: { team_slug: "platform-engineering", agent_id: "incident-agent" } },
      });
    }
    if (url === "/api/admin/webex/runtime/status") {
      return response({
        data: {
          route_mode: "db_prefer",
          static_config: { spaces: 1, routes: 1 },
          route_cache: { ttl_seconds: 60, cache_size: 1 },
          thread_context: { enabled: true, max_messages: 10, max_chars: 4000 },
        },
      });
    }
    if (url === "/api/admin/webex/runtime/reload") {
      return response({ data: { reloaded: "all" } });
    }
    if (url === "/api/admin/webex/runtime/sync-from-config") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return response({
        data: {
          dry_run: Boolean(body.dry_run),
          spaces_seen: 1,
          routes_planned: 1,
          routes_upserted: body.dry_run ? 0 : 1,
          openfga_tuples_written: body.dry_run ? 0 : 1,
        },
      });
    }
    if (url.endsWith("/routes") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body ?? "{}"));
      return response({ data: { routes: body.routes } });
    }
    if (url.endsWith("/routes") && init?.method === "DELETE") {
      return response({ data: { deleted: { agent_id: "foo-bar" } } });
    }
    if (url.endsWith("/routes")) {
      return response({ data: { routes: [{ agent_id: "incident-agent", enabled: true, priority: 100, users: { enabled: true, listen: "mention" } }] } });
    }
    if (url.endsWith("/diagnostics")) {
      return response({
        data: {
          openfga: { reachable: true, tuple_count: 1 },
          warnings: [
            "agent:foo-bar has Mongo route metadata, but the OpenFGA tuple is missing; runtime ignores it.",
          ],
          routes: [
            { agent_id: "foo-bar", openfga_tuple: false, route_metadata: true, listen: "message", runtime_matches: { mention: false, message: true }, warnings: [] },
            { agent_id: "incident-agent", openfga_tuple: true, route_metadata: true, listen: "mention", runtime_matches: { mention: true, message: false }, warnings: [] },
          ],
          last_runtime_error: { ts: "2026-05-18T07:50:00.000Z", reason_code: "OPENFGA_READ_FAILED", message: "OpenFGA tuple read failed" },
        },
      });
    }
    return response({});
  });
}

beforeEach(() => {
  mockToast.mockClear();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  setupFetchMock();
});

afterEach(() => { jest.useRealTimers(); });

function response(payload: unknown): Response {
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) } as Response;
}

async function switchToTab(name: "Configured spaces" | "Onboard spaces" | "Advanced") {
  fireEvent.click(await screen.findByRole("tab", { name }));
}

async function expandSpaceRow(spaceName: string) {
  const row = (await screen.findByText(spaceName)).closest("tr");
  if (!row) throw new Error(`Row for "${spaceName}" not found`);
  fireEvent.click(row);
}

// ── Tab layout ──────────────────────────────────────────────────────────────

it("organises Webex admin into Configured / Onboard / Advanced tabs, mirrors Slack layout", async () => {
  render(<WebexSpaceRebacPanel />);

  // Configured tab is default and shows the space table once data loads
  expect(await screen.findByRole("tab", { name: "Configured spaces" })).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByRole("region", { name: "Configured Webex spaces" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Onboarding Default Selection" })).not.toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Advanced Setup - Import/Sync with Webex Bot" })).not.toBeInTheDocument();

  // Onboard tab shows discovery wizard only.
  await switchToTab("Onboard spaces");
  expect(screen.queryByRole("region", { name: "Onboarding Default Selection" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Find Webex Spaces with Bot Integration" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Configured Webex spaces" })).not.toBeInTheDocument();

  // Advanced tab shows runtime status controls only
  await switchToTab("Advanced");
  expect(await screen.findByRole("region", { name: "Advanced Setup - Import/Sync with Webex Bot" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "Onboarding Default Selection" })).not.toBeInTheDocument();
});

// ── Configured spaces table + diagnostics ──────────────────────────────────

it("shows spaces in a table and expands a row to show diagnostics without manual route controls", async () => {
  render(<WebexSpaceRebacPanel />);

  // Space appears in the table; no "X grants" column
  expect(await screen.findByText("Platform Alerts")).toBeInTheDocument();
  expect(screen.queryByText(/0 grants/i)).not.toBeInTheDocument();

  // Expand the row
  await expandSpaceRow("Platform Alerts");
  expect(await screen.findByText("Diagnostics")).toBeInTheDocument();
  expect(await screen.findByText(/OpenFGA tuple read failed/i)).toBeInTheDocument();

  // No manual route form — Webex routes are managed via onboarding + auto-fix
  expect(screen.queryByLabelText("Dynamic Agent")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Create Association" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /edit agent:incident-agent/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /delete agent:incident-agent/i })).not.toBeInTheDocument();
});

it("fixes stale diagnostic route metadata (orphan) by issuing DELETE", async () => {
  render(<WebexSpaceRebacPanel />);
  await expandSpaceRow("Platform Alerts");

  fireEvent.click(await screen.findByRole("button", { name: /Fix agent:foo-bar routing/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-abc/routes",
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ agent_id: "foo-bar" }) })
    )
  );
});

it("fixes mention-only diagnostic route by lifting listen mode to all", async () => {
  render(<WebexSpaceRebacPanel />);
  await expandSpaceRow("Platform Alerts");

  fireEvent.click(await screen.findByRole("button", { name: /Fix agent:incident-agent routing/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-abc/routes",
      expect.objectContaining({ method: "PUT", body: expect.stringContaining('"listen":"all"') })
    )
  );
});

// ── Discovery + onboarding ─────────────────────────────────────────────────

it("discovers Webex bot spaces, auto-selects new ones, and POSTs per-space defaults on apply", async () => {
  render(<WebexSpaceRebacPanel />);
  await switchToTab("Onboard spaces");

  fireEvent.click(screen.getByRole("button", { name: "Find Webex Spaces with Bot Integration" }));

  // Only the new space (Incident War Room) is auto-selected; existing one (Platform Alerts) is not
  expect(await screen.findByText(/2 bot-visible spaces discovered/i)).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Import Incident War Room/i })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Import Platform Alerts/i })).not.toBeChecked();
  await pickTeam("Team for Incident War Room", "platform-engineering");
  await pickAgent("Dynamic Agent for Incident War Room", "incident-agent");

  fireEvent.click(screen.getByRole("button", { name: /^Set up \d+ spaces?$/ }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/defaults",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          team_slug: "platform-engineering",
          agent_id: "incident-agent",
          create_routes: true,
          manual_spaces: [{ id: "space-new-123", name: "Incident War Room" }],
        }),
      })
    )
  );
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(expect.stringContaining("Discovered Webex spaces applied"), "success")
  );
  expect(screen.queryByText("Ready to set up")).not.toBeInTheDocument();
  expect(screen.getByText("Configured")).toBeInTheDocument();
});

it("allows discovery before global defaults are configured, but does not auto-select not-ready rows", async () => {
  const baseFetch = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/webex/spaces/defaults" && init?.method !== "POST") {
      return response({ data: { defaults: { team_slug: "", agent_id: "" } } });
    }
    return baseFetch?.(url, init) ?? response({});
  });

  render(<WebexSpaceRebacPanel />);
  await switchToTab("Onboard spaces");

  const discoverButton = await screen.findByRole("button", { name: "Find Webex Spaces with Bot Integration" });
  await waitFor(() => expect(discoverButton).toBeEnabled());
  fireEvent.click(discoverButton);

  await waitFor(() =>
    expect(fetchMock.mock.calls.some(([url, init]) =>
      String(url).startsWith("/api/admin/webex/available-spaces") && init?.cache === "no-store"
    )).toBe(true)
  );
  expect(await screen.findByText(/2 bot-visible spaces discovered/i)).toBeInTheDocument();
  // No saved defaults and >1 enabled agent (so no single-agent fallback) →
  // the row has no agent and is "blocked", so it must NOT be auto-selected.
  expect(screen.getByRole("checkbox", { name: /Import Incident War Room/i })).not.toBeChecked();
});

it("auto-selects a ready row via single team+agent fallback when no defaults are saved", async () => {
  const baseFetch = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/webex/spaces/defaults" && init?.method !== "POST") {
      return response({ data: { defaults: { team_slug: "", agent_id: "" } } });
    }
    // Exactly one enabled Dynamic Agent → single-agent fallback applies.
    if (url === "/api/dynamic-agents?enabled_only=true") {
      return response({ data: { items: [{ _id: "incident-agent", name: "Incident Agent" }] } });
    }
    return baseFetch?.(url, init) ?? response({});
  });

  render(<WebexSpaceRebacPanel />);
  await switchToTab("Onboard spaces");

  const discoverButton = await screen.findByRole("button", { name: "Find Webex Spaces with Bot Integration" });
  await waitFor(() => expect(discoverButton).toBeEnabled());
  fireEvent.click(discoverButton);

  expect(await screen.findByText(/2 bot-visible spaces discovered/i)).toBeInTheDocument();
  // One team (platform-engineering) + one agent (incident-agent) are the sole
  // options, so the new row is prefilled, ready, and auto-selected.
  expect(screen.getByRole("checkbox", { name: /Import Incident War Room/i })).toBeChecked();
  expect(await screen.findByText("Ready to set up")).toBeInTheDocument();
});

// ── Advanced tab ───────────────────────────────────────────────────────────

it("shows Webex-specific runtime status including Thread context tile and triggers YAML sync", async () => {
  render(<WebexSpaceRebacPanel />);
  await switchToTab("Advanced");

  expect(await screen.findByText("db_prefer")).toBeInTheDocument();
  expect(await screen.findByText(/1 cached space/i)).toBeInTheDocument();
  expect(screen.getByText("Thread context")).toBeInTheDocument();
  expect(screen.getByText("Enabled, 10 messages / 4000 chars")).toBeInTheDocument();

  expect(screen.getByRole("button", { name: "Help: Route mode" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Help: Thread context" })).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Import from YAML" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/runtime/sync-from-config",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ dry_run: true }) })
    )
  );
  expect(await screen.findByText("Preview complete")).toBeInTheDocument();

  const importButton = await screen.findByRole("button", { name: "Apply Import" });
  await waitFor(() => expect(importButton).not.toBeDisabled());
  fireEvent.click(importButton);
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/runtime/sync-from-config",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ dry_run: false }) })
    )
  );
  expect(await screen.findByText("Apply complete")).toBeInTheDocument();
});

it("opens sync modal with accurate preview and apply counts", async () => {
  render(<WebexSpaceRebacPanel />);
  await switchToTab("Advanced");

  const previewButton = await screen.findByRole("button", { name: "Import from YAML" });
  await waitFor(() => expect(previewButton).toBeEnabled());
  fireEvent.click(previewButton);

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("Webex Bot Config Sync Preview")).toBeInTheDocument();
  expect(await screen.findByText("Preview complete")).toBeInTheDocument();
  expect(screen.getByText("1 route planned")).toBeInTheDocument();
  expect(screen.getByText("1 space scanned")).toBeInTheDocument();
  expect(screen.getByText("0 routes upserted")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Apply Import" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/runtime/sync-from-config",
      expect.objectContaining({ body: JSON.stringify({ dry_run: false }) })
    )
  );
  expect(await screen.findByText("Apply complete")).toBeInTheDocument();
  expect(screen.getByText("1 route upserted")).toBeInTheDocument();
  expect(screen.getByText("1 OpenFGA tuple written")).toBeInTheDocument();
});
