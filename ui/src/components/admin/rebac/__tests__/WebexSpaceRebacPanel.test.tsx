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
    if (
      url === "/api/admin/webex/spaces" ||
      url === "/api/admin/webex/spaces?health=1"
    ) {
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
            },
            {
              id: "space-new-123",
              name: "Incident War Room",
              type: "group",
              is_locked: false,
            },
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
        data: {
          teams: [
            {
              _id: "team-1",
              slug: "platform-engineering",
              name: "Platform Engineering",
            },
          ],
        },
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
    if (url.endsWith("/routes") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body ?? "{}"));
      return response({ data: { routes: body.routes } });
    }
    if (url.endsWith("/routes") && init?.method === "DELETE") {
      return response({ data: { deleted: { agent_id: "foo-bar" } } });
    }
    if (url.endsWith("/routes")) {
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
    if (url.endsWith("/diagnostics")) {
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

it("shows the onboarding loading state while configured spaces seed the table", async () => {
  let resolveSpaces: ((value: Response) => void) | undefined;
  const spacesPromise = new Promise<Response>((resolve) => {
    resolveSpaces = resolve;
  });
  fetchMock.mockImplementation(async (url: string) => {
    if (
      url === "/api/admin/webex/spaces" ||
      url === "/api/admin/webex/spaces?health=1"
    ) {
      return spacesPromise;
    }
    if (url === "/api/dynamic-agents?enabled_only=true") {
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

it("renders Webex as a single onboarding view without Configured or Advanced tabs", async () => {
  render(<WebexSpaceRebacPanel />);

  expect(await screen.findByText("Configure spaces")).toBeInTheDocument();
  expect(
    screen.queryByRole("tablist", { name: "Webex admin views" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("tab", { name: "Configured spaces" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("tab", { name: "Advanced" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Find spaces" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Configured Webex spaces" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", {
      name: "Advanced Setup - Import/Sync with Webex Bot",
    }),
  ).not.toBeInTheDocument();
});

it("ignores stale Webex subtab URL params and stays on onboarding", async () => {
  currentSearchParams = new URLSearchParams("subtab=advanced");
  render(<WebexSpaceRebacPanel />);

  expect(await screen.findByText("Configure spaces")).toBeInTheDocument();
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
    if (
      url === "/api/admin/webex/spaces" ||
      url === "/api/admin/webex/spaces?health=1"
    ) {
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

it("shows direct Webex rooms as personal DMs and excludes them from team setup", async () => {
  const baseFetch = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/admin/webex/available-spaces")) {
      return response({
        data: {
          spaces: [
            {
              id: "direct-room-123456",
              name: "Sri Aradhyula",
              type: "direct",
              is_locked: false,
            },
            {
              id: "space-new-123",
              name: "Incident War Room",
              type: "group",
              is_locked: false,
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
      name: /Discovered: 3 .* Configured: 1/i,
    }),
  ).toBeInTheDocument();
  const directCheckbox = screen.getByRole("checkbox", {
    name: /Import Sri Aradhyula/i,
  });
  expect(directCheckbox).toBeDisabled();
  expect(directCheckbox).not.toBeChecked();
  expect(
    screen.queryByLabelText("Team for Sri Aradhyula"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Dynamic Agent for Sri Aradhyula"),
  ).not.toBeInTheDocument();
  expect(screen.getAllByText("Personal DM").length).toBeGreaterThan(0);
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
    ).toEqual([{ id: "space-new-123", name: "Incident War Room" }]);
  });
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
