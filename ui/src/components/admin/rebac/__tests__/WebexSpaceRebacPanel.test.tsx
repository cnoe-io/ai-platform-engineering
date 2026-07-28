import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockToast = jest.fn();
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

const replaceMock = jest.fn();
let currentSearchParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => currentSearchParams,
}));

import { WebexSpaceRebacPanel } from "../WebexSpaceRebacPanel";
import { pickTeam } from "@/__test-utils__/team-picker";
import { pickAgent } from "@/__test-utils__/agent-picker";

const fetchMock = jest.fn();

function setupFetchMock() {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/admin/webex/spaces?health=1")) {
      return response({
        data: {
          spaces: [
            {
              workspace_id: "WEBEX-WORKSPACE",
              space_id: "space-abc",
              space_name: "Platform Alerts",
              team_slug: "platform-engineering",
              primary_agent_id: "incident-agent",
              bot_id: "primary",
              active_grants: 1,
            },
          ],
        },
      });
    }
    if (String(url).startsWith("/api/admin/webex/available-spaces")) {
      return response({
        data: {
          spaces: [
            {
              id: "space-abc",
              name: "Platform Alerts",
              type: "group",
              is_locked: false,
              available_bot_ids: ["primary", "secondary"],
            },
            {
              id: "space-new-123",
              name: "Incident War Room",
              type: "group",
              is_locked: false,
              available_bot_ids: ["primary", "secondary"],
            },
          ],
          has_more: false,
          next_cursor: null,
        },
      });
    }
    if (url === "/api/admin/webex/bots") {
      return response({
        data: {
          bots: [
            { id: "primary", name: "Primary bot", available: true },
            {
              id: "secondary",
              name: "Secondary bot",
              available: true,
            },
          ],
        },
      });
    }
    if (url === "/api/admin/webex/migrations/bot-ownership" && init?.method === "DELETE") {
      return response({
        data: {
          result: {
            spaces_cleaned: 1,
            team_mappings_deleted: 1,
            agent_routes_deleted: 1,
            legacy_openfga_tuples_deleted: 1,
          },
        },
      });
    }
    if (url === "/api/admin/webex/migrations/bot-ownership") {
      return response({
        data: {
          candidates: [
            {
              workspace_id: "WEBEX-WORKSPACE",
              space_id: "legacy-space",
              space_name: "Legacy Space",
              team_mapping_count: 1,
              route_count: 1,
              mongo_agent_ids: ["incident-agent"],
              openfga_agent_ids: ["incident-agent"],
              mapping_details: [{
                team_id: "team-1",
                team_slug: "platform-engineering",
              }],
              mongo_route_details: [{ agent_id: "incident-agent" }],
              openfga_grants: [{
                user: "webex_space:WEBEX-WORKSPACE--legacy-space",
                relation: "user",
                object: "agent:incident-agent",
              }],
            },
          ],
        },
      });
    }
    if (url.startsWith("/api/dynamic-agents?enabled_only=true")) {
      return response({
        data: {
          items: [
            { _id: "test-april-2025", name: "Test April 2025" },
            { _id: "incident-agent", name: "Incident Agent" },
            { _id: "fallback-agent", name: "Fallback Agent" },
          ],
        },
      });
    }
    if (String(url).startsWith("/api/admin/webex/direct-users")) {
      if (init?.method === "PUT" || init?.method === "DELETE") {
        return response({ data: { saved: init.method === "PUT", deleted: init.method === "DELETE" } });
      }
      return response({
        data: {
          users: [
            {
              keycloak_user_id: "user-1",
              email: "user@example.com",
              display_name: "Example User",
              webex_user_id: null,
              enabled: false,
              configured: false,
              inherited: false,
              state: "not_allowed",
              expected_webex_email: "user@example.com",
              agent_id: "",
            },
          ],
          bot_id: "primary",
          dm_access_mode: "allowlist",
          default_agent_id: null,
        },
      });
    }
    if (url === "/api/dynamic-agents/teams") {
      return response({
        success: true,
        data: [
          {
            _id: "team-1",
            slug: "platform-engineering",
            name: "Platform Engineering",
          },
        ],
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
          defaults: {
            ...body,
            source: "db",
            updated_at: "2026-05-27T08:00:00.000Z",
            updated_by: "admin@example.com",
          },
        },
      });
    }
    if (url === "/api/admin/webex/spaces/defaults") {
      return response({
        data: {
          defaults: {
            team_slug: "platform-engineering",
            agent_id: "incident-agent",
          },
        },
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
    if (String(url).includes("/routes?") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body ?? "{}"));
      return response({ data: { routes: body.routes } });
    }
    if (String(url).includes("/routes?") && init?.method === "DELETE") {
      return response({ data: { deleted: { agent_id: "foo-bar" } } });
    }
    if (String(url).includes("/routes?")) {
      return response({
        data: {
          routes: [
            {
              agent_id: "incident-agent",
              enabled: true,
              priority: 100,
              users: { enabled: true, listen: "mention" },
            },
          ],
        },
      });
    }
    if (String(url).includes("/diagnostics?")) {
      return response({
        data: {
          openfga: { reachable: true, tuple_count: 1 },
          warnings: [
            "agent:foo-bar has Mongo route metadata, but the OpenFGA tuple is missing; runtime ignores it.",
          ],
          routes: [
            {
              agent_id: "foo-bar",
              openfga_tuple: false,
              route_metadata: true,
              listen: "message",
              runtime_matches: { mention: false, message: true },
              warnings: [],
            },
            {
              agent_id: "incident-agent",
              openfga_tuple: true,
              route_metadata: true,
              listen: "mention",
              runtime_matches: { mention: true, message: false },
              warnings: [],
            },
          ],
          last_runtime_error: {
            ts: "2026-05-18T07:50:00.000Z",
            reason_code: "OPENFGA_READ_FAILED",
            message: "OpenFGA tuple read failed",
          },
        },
      });
    }
    if (
      String(url).startsWith("/api/admin/webex/spaces/WEBEX-WORKSPACE/space-abc?") &&
      init?.method === "DELETE"
    ) {
      return response({ data: { deleted: { space_id: "space-abc" } } });
    }
    return response({});
  });
}

beforeEach(() => {
  mockToast.mockClear();
  replaceMock.mockReset();
  currentSearchParams = new URLSearchParams();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  setupFetchMock();
});

afterEach(() => {
  jest.useRealTimers();
});

function response(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  } as Response;
}

async function clickFindSpaces() {
  const discoverButton = await screen.findByRole("button", {
    name: "Find spaces",
  });
  await waitFor(() => expect(discoverButton).toBeEnabled());
  fireEvent.click(discoverButton);
}

async function clickRefreshSpaces() {
  const refreshButton = await screen.findByRole("button", {
    name: "Refresh spaces",
  });
  await waitFor(() => expect(refreshButton).toBeEnabled());
  fireEvent.click(refreshButton);
}

it("scopes the configured space list to the simulated user", async () => {
  render(
    <WebexSpaceRebacPanel
      selfService
      disabled
      simulationTarget={{ type: "user", id: "target-sub" }}
    />,
  );

  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces?simulate_type=user&simulate_id=target-sub&health=1&bot_id=primary",
    );
  });
});

it("shows the onboarding loading state while configured spaces seed the table", async () => {
  let resolveSpaces: ((value: Response) => void) | undefined;
  const spacesPromise = new Promise<Response>((resolve) => {
    resolveSpaces = resolve;
  });
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).startsWith("/api/admin/webex/spaces?health=1")) {
      return spacesPromise;
    }
    if (url.startsWith("/api/dynamic-agents?enabled_only=true")) {
      return response({ data: { items: [] } });
    }
    return response({});
  });

  render(<WebexSpaceRebacPanel />);
  expect(screen.getByTestId("discovery-loading")).toBeInTheDocument();
  expect(screen.getByText("Loading configured spaces…")).toBeInTheDocument();
  expect(
    screen.queryByText("No spaces configured yet."),
  ).not.toBeInTheDocument();

  resolveSpaces?.(response({ data: { spaces: [] } }));
  await waitFor(() =>
    expect(screen.queryByTestId("discovery-loading")).not.toBeInTheDocument(),
  );
});

// ── Single onboarding layout ────────────────────────────────────────────────

it("renders Webex with Configure, Configured, and 1:1 tabs but no Advanced tab", async () => {
  render(<WebexSpaceRebacPanel />);

  // Default landing tab is "Configure spaces"
  expect(
    await screen.findByRole("tab", { name: "Configure spaces" }),
  ).toBeInTheDocument();
  // "Configured spaces" tab is present for navigation back to the configured table
  expect(
    screen.getByRole("tab", { name: "Configured spaces" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "1:1 Messages" })).toBeInTheDocument();
  // The focused Webex switcher does not expose the generic Advanced tab.
  expect(
    screen.queryByRole("tab", { name: "Advanced" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Find spaces" }),
  ).toBeInTheDocument();
  // Configured table and Advanced section are not visible on the default tab
  expect(
    screen.queryByRole("region", { name: "Configured Webex spaces" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", {
      name: "Advanced Setup - Import/Sync with Webex Bot",
    }),
  ).not.toBeInTheDocument();
});

it("opens Configure spaces from the empty configured-spaces action", async () => {
  const baseFetch = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/admin/webex/spaces?health=1")) {
      return response({ data: { spaces: [] } });
    }
    return baseFetch?.(url, init) ?? response({});
  });

  render(<WebexSpaceRebacPanel />);
  fireEvent.click(await screen.findByRole("tab", { name: "Configured spaces" }));
  fireEvent.click(await screen.findByRole("button", { name: "Onboard spaces" }));

  expect(screen.getByRole("tab", { name: "Configure spaces" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(screen.getByRole("button", { name: "Find spaces" })).toBeInTheDocument();
});

it("refreshes configured spaces when the tab opens and on explicit refresh", async () => {
  render(<WebexSpaceRebacPanel />);

  await screen.findByRole("button", { name: "Find spaces" });
  const callsBeforeTab = fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith("/api/admin/webex/spaces?health=1"),
  ).length;

  fireEvent.click(screen.getByRole("tab", { name: "Configured spaces" }));
  await waitFor(() => expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("/api/admin/webex/spaces?health=1"),
    ).length,
  ).toBeGreaterThan(callsBeforeTab));

  const callsBeforeRefresh = fetchMock.mock.calls.filter(([url]) =>
    String(url).startsWith("/api/admin/webex/spaces?health=1"),
  ).length;
  fireEvent.click(await screen.findByRole("button", { name: "Refresh configured spaces" }));
  await waitFor(() => expect(
    fetchMock.mock.calls.filter(([url]) =>
      String(url).startsWith("/api/admin/webex/spaces?health=1"),
    ).length,
  ).toBeGreaterThan(callsBeforeRefresh));
});

it("ignores stale Webex subtab URL params and stays on onboarding", async () => {
  currentSearchParams = new URLSearchParams("subtab=advanced");
  render(<WebexSpaceRebacPanel />);

  expect(
    await screen.findByRole("tab", { name: "Configure spaces" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Find spaces" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("region", {
      name: "Advanced Setup - Import/Sync with Webex Bot",
    }),
  ).not.toBeInTheDocument();
  expect(replaceMock).not.toHaveBeenCalled();
});

// ── Discovery + onboarding ─────────────────────────────────────────────────

it("seeds configured Webex spaces on the onboard tab before discovery", async () => {
  render(<WebexSpaceRebacPanel />);

  expect(await screen.findByText("Platform Alerts")).toBeInTheDocument();
  expect(screen.getByText("Configured")).toBeInTheDocument();
  expect(
    fetchMock.mock.calls.some(([url]) =>
      String(url).startsWith("/api/admin/webex/available-spaces"),
    ),
  ).toBe(false);
});

it("filters configured Webex spaces locally before live discovery runs", async () => {
  const baseFetch = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/admin/webex/spaces?health=1")) {
      return response({
        data: {
          spaces: [
            {
              workspace_id: "WEBEX-WORKSPACE",
              space_id: "space-abc",
              space_name: "Platform Alerts",
              team_slug: "platform-engineering",
              primary_agent_id: "incident-agent",
              active_grants: 1,
            },
            {
              workspace_id: "WEBEX-WORKSPACE",
              space_id: "space-caipe",
              space_name: "CAIPE Demo",
              team_slug: "platform-engineering",
              primary_agent_id: "incident-agent",
              active_grants: 1,
            },
          ],
        },
      });
    }
    return baseFetch?.(url, init) ?? response({});
  });

  render(<WebexSpaceRebacPanel />);

  expect(await screen.findByText("Platform Alerts")).toBeInTheDocument();
  expect(screen.getByText("CAIPE Demo")).toBeInTheDocument();

  fireEvent.change(screen.getByRole("searchbox", { name: "Search spaces" }), {
    target: { value: "CAIPE" },
  });

  expect(screen.getByText("CAIPE Demo")).toBeInTheDocument();
  expect(screen.queryByText("Platform Alerts")).not.toBeInTheDocument();
  expect(
    fetchMock.mock.calls.some(([url]) =>
      String(url).startsWith("/api/admin/webex/available-spaces"),
    ),
  ).toBe(false);
});

it("discovers Webex bot spaces, auto-selects new ones, and POSTs per-space defaults on apply", async () => {
  render(<WebexSpaceRebacPanel />);

  await clickFindSpaces();

  // Only the new space (Incident War Room) is auto-selected; existing one (Platform Alerts) is not
  expect(
    await screen.findByRole("status", {
      name: /Discovered: 2 .* Configured: 1/i,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: /Import Incident War Room/i }),
  ).toBeChecked();
  expect(
    screen.getByRole("checkbox", { name: /Import Platform Alerts/i }),
  ).not.toBeChecked();
  await pickTeam("Team for Incident War Room", "platform-engineering");
  await pickAgent("Dynamic Agent for Incident War Room", "incident-agent");
  expect(screen.getByRole("combobox", { name: "Webex bot" })).toHaveValue("primary");

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
          manual_spaces: [{ id: "space-new-123", name: "Incident War Room", bot_id: "primary" }],
        }),
      }),
    ),
  );
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Discovered Webex spaces applied"),
      "success",
    ),
  );
  expect(screen.queryByText("Ready to set up")).not.toBeInTheDocument();
  expect(screen.getAllByText("Configured").length).toBeGreaterThan(0);
});

it("uses all-spaces bot defaults for new spaces and preserves saved overrides", async () => {
  const baseFetch = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/webex/bots") {
      return response({
        data: {
          bots: [{
            id: "primary",
            name: "Primary bot",
            available: true,
            spaces: {
              accessMode: "all_spaces",
              defaultTeamSlug: "default-team",
              defaultAgentId: "default-agent",
            },
            directMessages: { accessMode: "allowlist", defaultAgentId: null },
          }],
        },
      });
    }
    if (url === "/api/dynamic-agents/teams") {
      return response({
        success: true,
        data: [
          { _id: "team-default", slug: "default-team", name: "Default Team" },
          { _id: "team-saved", slug: "saved-team", name: "Saved Team" },
        ],
      });
    }
    if (String(url).startsWith("/api/dynamic-agents?enabled_only=true")) {
      return response({
        data: {
          items: [
            { _id: "default-agent", name: "Default Agent" },
            { _id: "saved-agent", name: "Saved Agent" },
          ],
        },
      });
    }
    if (String(url).startsWith("/api/admin/webex/spaces?health=1")) {
      return response({
        data: {
          spaces: [{
            workspace_id: "WEBEX-WORKSPACE",
            space_id: "space-abc",
            space_name: "Saved Space",
            team_slug: "saved-team",
            primary_agent_id: "saved-agent",
            bot_id: "primary",
            active_grants: 1,
          }],
        },
      });
    }
    return baseFetch?.(url, init) ?? response({});
  });

  render(<WebexSpaceRebacPanel />);
  await clickFindSpaces();

  expect(await screen.findByLabelText("Team for Incident War Room")).toHaveTextContent("Default Team");
  expect(screen.getByLabelText("Dynamic Agent for Incident War Room")).toHaveTextContent("Default Agent");
  expect(screen.getByLabelText("Team for Platform Alerts")).toHaveTextContent("Saved Team");
  expect(screen.getByLabelText("Dynamic Agent for Platform Alerts")).toHaveTextContent("Saved Agent");
});

it("uses one top-level Webex bot selector for space discovery", async () => {
  render(<WebexSpaceRebacPanel />);

  await clickFindSpaces();
  const botSelector = screen.getByRole("combobox", { name: "Webex bot" });
  expect(screen.queryByRole("combobox", { name: /Webex bot for / })).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.some(([url]) =>
    new URL(String(url), "http://localhost").searchParams.get("bot_id") === "primary",
  )).toBe(true);

  fireEvent.change(botSelector, { target: { value: "secondary" } });
  await clickFindSpaces();
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) =>
    new URL(String(url), "http://localhost").searchParams.get("bot_id") === "secondary",
  )).toBe(true));
});

it("forces a fresh Webex discovery when Refresh spaces is clicked", async () => {
  render(<WebexSpaceRebacPanel />);

  await clickFindSpaces();
  await screen.findByRole("button", { name: "Refresh spaces" });
  await clickRefreshSpaces();

  await waitFor(() => {
    const discoveryCalls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((url) => url.startsWith("/api/admin/webex/available-spaces"));
    expect(discoveryCalls).toHaveLength(2);
    expect(new URL(discoveryCalls[0], "http://localhost").searchParams.has("refresh")).toBe(false);
    expect(new URL(discoveryCalls[1], "http://localhost").searchParams.get("refresh")).toBe("1");
  });
});

it("hides direct Webex rooms from space discovery", async () => {
  const baseFetch = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/admin/webex/available-spaces")) {
      return response({
        data: {
          spaces: [
            {
              id: "direct-room-123456",
              name: "Example User",
              type: "direct",
              is_locked: false,
              available_bot_ids: ["primary"],
            },
            {
              id: "space-new-123",
              name: "Incident War Room",
              type: "group",
              is_locked: false,
              available_bot_ids: ["primary"],
            },
          ],
          has_more: false,
          next_cursor: null,
        },
      });
    }
    return baseFetch?.(url, init) ?? response({});
  });

  render(<WebexSpaceRebacPanel />);

  await clickFindSpaces();

  expect(
    await screen.findByRole("status", {
      name: /Discovered: 2 .* Configured: 1/i,
    }),
  ).toBeInTheDocument();
  expect(screen.queryByText("Example User")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Set up 1 space" })).toBeEnabled();

  fireEvent.click(screen.getByRole("button", { name: "Set up 1 space" }));

  await waitFor(() => {
    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === "/api/admin/webex/spaces/defaults" && init?.method === "POST",
    );
    expect(postCall).toBeTruthy();
    expect(
      JSON.parse(String(postCall?.[1]?.body ?? "{}")).manual_spaces,
    ).toEqual([{ id: "space-new-123", name: "Incident War Room", bot_id: "primary" }]);
  });
});

it("onboards deployment users independently for the bot selected above the table", async () => {
  render(<WebexSpaceRebacPanel />);

  fireEvent.click(await screen.findByRole("tab", { name: "1:1 Messages" }));
  expect(await screen.findByText("Example User")).toBeInTheDocument();
  expect(screen.getByText("Allowlist")).toBeInTheDocument();
  const botSelector = screen.getByRole("combobox", { name: "Webex bot" });
  expect(botSelector).toHaveValue("primary");
  expect(screen.queryByRole("combobox", { name: "Webex bot for user@example.com" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("checkbox", { name: "Allow direct messages for user@example.com" }));
  fireEvent.change(screen.getByRole("combobox", { name: "Agent for user@example.com" }), {
    target: { value: "incident-agent" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save 1:1 access for user@example.com" }));

  await waitFor(() => {
    const putCall = fetchMock.mock.calls.find(
      ([url, init]) => url === "/api/admin/webex/direct-users" && init?.method === "PUT",
    );
    expect(putCall).toBeTruthy();
    expect(JSON.parse(String(putCall?.[1]?.body))).toMatchObject({
      bot_id: "primary",
      keycloak_user_id: "user-1",
      agent_id: "incident-agent",
    });
  });

  fireEvent.change(botSelector, { target: { value: "secondary" } });
  await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => {
    const parsed = new URL(String(url), "http://localhost");
    return parsed.pathname === "/api/admin/webex/direct-users" &&
      parsed.searchParams.get("bot_id") === "secondary";
  })).toBe(true));
});

it("shows inherited defaults and allows overrides in all-users mode", async () => {
  const baseFetch = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (
      String(url).startsWith("/api/admin/webex/direct-users") &&
      !init?.method
    ) {
      return response({
        data: {
          users: [
            {
              keycloak_user_id: "user-1",
              email: "user@example.com",
              display_name: "Example User",
              webex_user_id: null,
              enabled: true,
              configured: false,
              inherited: true,
              state: "inherited",
              expected_webex_email: "user@example.com",
              agent_id: "fallback-agent",
            },
          ],
          bot_id: "primary",
          dm_access_mode: "all_users",
          default_agent_id: "fallback-agent",
        },
      });
    }
    return baseFetch?.(url, init) ?? response({});
  });

  render(<WebexSpaceRebacPanel />);

  fireEvent.click(await screen.findByRole("tab", { name: "1:1 Messages" }));

  expect(await screen.findByText("All deployment users")).toBeInTheDocument();
  expect(
    screen.getByText(/configured default unless an admin saves an explicit override/i),
  ).toBeInTheDocument();
  expect(
    screen.getByText("Bot default agent: fallback-agent"),
  ).toBeInTheDocument();
  expect(
    screen.getByLabelText("Allow direct messages for user@example.com"),
  ).toBeChecked();
  expect(screen.queryByRole("combobox", { name: "Team for user@example.com" })).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Agent for user@example.com" })).toHaveValue(
    "fallback-agent",
  );
  expect(screen.getByText("inherited")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Save 1:1 access for user@example.com" }),
  ).toBeEnabled();
});

it("allows discovery before global defaults are configured", async () => {
  const baseFetch = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/webex/spaces/defaults" && init?.method !== "POST") {
      return response({ data: { defaults: { team_slug: "", agent_id: "" } } });
    }
    return baseFetch?.(url, init) ?? response({});
  });

  render(<WebexSpaceRebacPanel />);

  await clickFindSpaces();

  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url]) =>
          String(url).startsWith("/api/admin/webex/available-spaces") &&
          String(url).includes("limit=200"),
      ),
    ).toBe(true),
  );
  expect(
    await screen.findByRole("status", {
      name: /Discovered: 2 .* Configured: 1/i,
    }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("checkbox", { name: /Import Incident War Room/i }),
  ).toBeChecked();
});

it("probes legacy botless ownership from the migration tab", async () => {
  render(<WebexSpaceRebacPanel />);

  fireEvent.click(await screen.findByRole("tab", { name: "Legacy migration" }));
  fireEvent.click(screen.getByRole("button", { name: "Probe legacy data" }));

  expect(await screen.findByText("Legacy Space")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/webex/migrations/bot-ownership",
    { cache: "no-store" },
  );
  expect(screen.getByRole("combobox", { name: "Webex bot for Legacy Space" })).toHaveValue("");

  fireEvent.click(screen.getByRole("button", { name: "Details" }));
  expect(screen.getByText("team:platform-engineering")).toBeInTheDocument();
  expect(screen.getByText("agent:incident-agent")).toBeInTheDocument();
  expect(screen.getByText("webex_space:WEBEX-WORKSPACE--legacy-space")).toBeInTheDocument();
  expect(screen.getByText("user -> agent:incident-agent")).toBeInTheDocument();
});

it("deletes selected legacy ownership after destructive confirmation", async () => {
  render(<WebexSpaceRebacPanel />);

  fireEvent.click(await screen.findByRole("tab", { name: "Legacy migration" }));
  fireEvent.click(screen.getByRole("button", { name: "Probe legacy data" }));
  fireEvent.click(await screen.findByRole("checkbox", { name: "Select Legacy Space" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete selected (1)" }));
  expect(screen.getByRole("heading", { name: "Delete selected legacy data?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete legacy data" }));

  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/webex/migrations/bot-ownership",
    expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({
        targets: [{ workspace_id: "WEBEX-WORKSPACE", space_id: "legacy-space" }],
      }),
    }),
  ));
  expect(mockToast).toHaveBeenCalledWith("Deleted legacy data for 1 Webex space.", "success");
});

it("deletes a configured Webex space after confirmation", async () => {
  render(<WebexSpaceRebacPanel />);

  fireEvent.click(await screen.findByRole("tab", { name: "Configured spaces" }));
  fireEvent.click(await screen.findByText("Platform Alerts"));
  fireEvent.click(await screen.findByRole("button", { name: "Delete space Platform Alerts" }));

  expect(screen.getByRole("heading", { name: "Delete space from CAIPE?" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete space", exact: true }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-abc?bot_id=primary",
      { method: "DELETE" },
    ),
  );
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith("Removed Platform Alerts from CAIPE.", "success"),
  );
});
