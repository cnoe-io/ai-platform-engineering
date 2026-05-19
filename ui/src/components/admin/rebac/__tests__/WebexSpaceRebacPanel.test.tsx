import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockToast = jest.fn();
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { WebexSpaceRebacPanel } from "../WebexSpaceRebacPanel";

const fetchMock = jest.fn();

const defaultSpaces = [
  {
    workspace_id: "WEBEX-WORKSPACE",
    space_id: "space-abc",
    space_name: "Platform Alerts",
    active_grants: 0,
  },
];

function setupFetchMock(
  spaces: Array<{
    workspace_id: string;
    space_id: string;
    space_name: string;
    active_grants: number;
  }> = defaultSpaces
) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/webex/spaces") {
      return response({
        data: { spaces },
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
          total_matches: 2,
          total_visible: 2,
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
            { _id: "team-1", slug: "platform-engineering", name: "Platform Engineering" },
          ],
        },
      });
    }
    if (url === "/api/admin/webex/spaces/defaults" && init?.method === "POST") {
      const body = JSON.parse(String(init.body ?? "{}"));
      return response({
        data: {
          summary: {
            spaces_seen: body.manual_spaces?.length ? 2 : 1,
            spaces_assigned_team: body.manual_spaces?.length ? 2 : 1,
            space_grants_ensured: body.manual_spaces?.length ? 2 : 1,
            routes_ensured: body.manual_spaces?.length ? 2 : 1,
            spaces_manual: body.manual_spaces?.length ?? 0,
            spaces_onboarded: body.manual_spaces?.length ?? 0,
            routes_preserved: 0,
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
          route_cache: { ttl_seconds: 60, cache_size: 1, cached_spaces: ["CAIPE/space-abc"] },
          last_sync: null,
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
      return response({
        data: {
          deleted: { agent_id: "incident-agent", route_metadata_deleted: true },
          openfga: { enabled: true, writes: 0, deletes: 1 },
        },
      });
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
            "Route agent:incident-agent only listens to mentions. Plain space messages will be ignored.",
          ],
          routes: [
            {
              agent_id: "foo-bar",
              openfga_tuple: false,
              route_metadata: true,
              listen: "message",
              runtime_matches: { mention: false, message: true },
              warnings: ["OpenFGA tuple is missing."],
            },
            {
              agent_id: "incident-agent",
              openfga_tuple: true,
              route_metadata: true,
              listen: "mention",
              runtime_matches: { mention: true, message: false },
              warnings: ["Plain space messages will be ignored."],
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

it("does not refetch the space catalog when only the selected space changes", async () => {
  setupFetchMock([
    ...defaultSpaces,
    {
      workspace_id: "WEBEX-WORKSPACE",
      space_id: "space-other",
      space_name: "Ops Room",
      active_grants: 0,
    },
  ]);

  render(<WebexSpaceRebacPanel />);

  await screen.findByRole("option", { name: "Platform Alerts" });
  const initialLoads = fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/admin/webex/spaces"
  ).length;
  expect(initialLoads).toBe(1);

  fireEvent.change(screen.getByRole("combobox", { name: "Space" }), {
    target: { value: "WEBEX-WORKSPACE/space-other" },
  });

  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Dynamic Agent" })).toBeInTheDocument()
  );

  const afterSelectLoads = fetchMock.mock.calls.filter(
    (call) => call[0] === "/api/admin/webex/spaces"
  ).length;
  expect(afterSelectLoads).toBe(initialLoads);
});

it("resets the route form when the selected space changes", async () => {
  setupFetchMock([
    ...defaultSpaces,
    {
      workspace_id: "WEBEX-WORKSPACE",
      space_id: "space-other",
      space_name: "Ops Room",
      active_grants: 0,
    },
  ]);

  render(<WebexSpaceRebacPanel />);

  await screen.findByRole("button", { name: /edit agent:incident-agent/i });
  fireEvent.click(screen.getByRole("button", { name: /edit agent:incident-agent/i }));
  expect(screen.getByRole("combobox", { name: "Dynamic Agent" })).toHaveValue("incident-agent");

  fireEvent.change(screen.getByRole("combobox", { name: "Space" }), {
    target: { value: "WEBEX-WORKSPACE/space-other" },
  });

  await waitFor(() =>
    expect(screen.getByRole("combobox", { name: "Dynamic Agent" })).toHaveValue("")
  );
});

it("normalizes invalid route priority before saving associations", async () => {
  render(<WebexSpaceRebacPanel />);

  const agentSelect = await screen.findByRole("combobox", { name: "Dynamic Agent" });
  fireEvent.change(agentSelect, { target: { value: "test-april-2025" } });
  fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Association" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-abc/routes",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"priority":100'),
      })
    )
  );
});

it("disables mutation controls when the panel is read-only", async () => {
  render(<WebexSpaceRebacPanel disabled />);

  expect(await screen.findByText("Webex Spaces")).toBeInTheDocument();
  expect(await screen.findByRole("combobox", { name: "Space" })).toBeDisabled();
  expect(await screen.findByRole("button", { name: "Create Association" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Apply Defaults To Webex Spaces" })).toBeDisabled();
});

it("renders Webex space management copy without Slack channel labels", async () => {
  render(<WebexSpaceRebacPanel />);

  expect(await screen.findByText("Webex Spaces")).toBeInTheDocument();
  expect(screen.queryByText("Slack Channels")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Channel")).not.toBeInTheDocument();
});

it("lays out Webex setup as five Slack-style sections in the requested order", async () => {
  render(<WebexSpaceRebacPanel />);

  expect(await screen.findByText("Webex Spaces")).toBeInTheDocument();
  const sections = [
    screen.getByRole("region", { name: "Step 1: Discover and Setup" }),
    screen.getByRole("region", { name: "Step 2a: Verify Webex Space ReBAC" }),
    screen.getByRole("region", { name: "Step 2b: Specify agent priority" }),
    screen.getByRole("region", { name: "[Optional] Global Space Defaults" }),
    screen.getByRole("region", { name: "Advanced Setup - Import/Sync with Webex Bot" }),
  ];

  expect(sections.map((section) => section.getAttribute("data-section-tone"))).toEqual([
    "sky",
    "violet",
    "violet",
    "teal",
    "slate",
  ]);
  expect(sections.map((section) => section.getAttribute("data-section-order"))).toEqual([
    "1",
    "2",
    "2b",
    "3",
    "5",
  ]);
  expect(screen.getByRole("heading", { name: "Step 1: Discover and Setup" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Step 2a: Verify Webex Space ReBAC" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Step 2b: Specify agent priority" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "[Optional] Global Space Defaults" })).toBeInTheDocument();
});

it("discovers Webex bot spaces and imports selected spaces with per-space defaults", async () => {
  render(<WebexSpaceRebacPanel />);

  fireEvent.change(await screen.findByRole("combobox", { name: "Default Team" }), {
    target: { value: "platform-engineering" },
  });
  fireEvent.change(await screen.findByRole("combobox", { name: "Default Dynamic Agent" }), {
    target: { value: "incident-agent" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Find Webex Spaces with Bot Integration" }));

  expect(await screen.findByText(/2 bot-visible spaces discovered/i)).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Import Incident War Room/i })).toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Import Platform Alerts/i })).not.toBeChecked();

  fireEvent.click(screen.getByRole("button", { name: "Apply discovered defaults" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/defaults",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          team_slug: "platform-engineering",
          agent_id: "incident-agent",
          create_routes: true,
          manual_spaces: [
            {
              id: "space-new-123",
              name: "Incident War Room",
            },
          ],
        }),
      })
    )
  );
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Discovered Webex spaces applied"),
      "success"
    )
  );
});

it("shows discovered Webex space setup feedback as a toast without shifting the action row", async () => {
  render(<WebexSpaceRebacPanel />);

  fireEvent.change(await screen.findByRole("combobox", { name: "Default Team" }), {
    target: { value: "platform-engineering" },
  });
  fireEvent.change(await screen.findByRole("combobox", { name: "Default Dynamic Agent" }), {
    target: { value: "incident-agent" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Find Webex Spaces with Bot Integration" }));

  expect(await screen.findByText(/2 bot-visible spaces discovered/i)).toBeInTheDocument();

  const applyButton = screen.getByRole("button", { name: "Apply discovered defaults" });
  fireEvent.click(applyButton);

  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Discovered Webex spaces applied"),
      "success"
    )
  );
  expect(applyButton.parentElement).not.toHaveTextContent(/Space setup applied/i);
});

it("allows Webex space discovery before global defaults are configured", async () => {
  const baseFetch = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/webex/spaces/defaults" && init?.method !== "POST") {
      return response({
        data: {
          defaults: {
            team_slug: "",
            agent_id: "",
          },
        },
      });
    }
    return baseFetch?.(url, init) ?? response({});
  });

  render(<WebexSpaceRebacPanel />);

  const discoverButton = await screen.findByRole("button", {
    name: "Find Webex Spaces with Bot Integration",
  });
  await waitFor(() => expect(discoverButton).toBeEnabled());
  fireEvent.click(discoverButton);

  await waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          String(url) === "/api/admin/webex/available-spaces?limit=500&refresh=1" &&
          init?.cache === "no-store"
      )
    ).toBe(true)
  );
  expect(await screen.findByText(/2 bot-visible spaces discovered/i)).toBeInTheDocument();
  expect(screen.getByRole("checkbox", { name: /Import Incident War Room/i })).toBeChecked();
});

it("uses enabled Dynamic Agents dropdown for Webex space-agent associations", async () => {
  render(<WebexSpaceRebacPanel />);

  expect(await screen.findByText(/Control which Dynamic Agents a Webex space may invoke/i)).toBeInTheDocument();
  expect(screen.queryByLabelText("Resource Type")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Action")).not.toBeInTheDocument();

  const agentSelect = await screen.findByRole("combobox", { name: "Dynamic Agent" });
  await waitFor(() =>
    expect(screen.getAllByRole("option", { name: "Test April 2025 (test-april-2025)" })).toHaveLength(2)
  );

  fireEvent.change(agentSelect, { target: { value: "test-april-2025" } });
  fireEvent.click(screen.getByRole("button", { name: "Create Association" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-abc/routes",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"agent_id":"test-april-2025"'),
      })
    )
  );
});

it("does not show legacy grant counts in the Webex space dropdown", async () => {
  render(<WebexSpaceRebacPanel />);

  const spaceSelect = await screen.findByRole("combobox", { name: "Space" });

  expect(spaceSelect).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("option", { name: "Platform Alerts" })).toBeInTheDocument());
  expect(screen.queryByRole("option", { name: /0 grants/i })).not.toBeInTheDocument();
});

it("fixes stale Webex runtime diagnostics by deleting orphaned route metadata", async () => {
  render(<WebexSpaceRebacPanel />);

  fireEvent.click(await screen.findByRole("button", { name: /Fix agent:foo-bar routing/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-abc/routes",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ agent_id: "foo-bar" }),
      })
    )
  );
});

it("surfaces Webex runtime diagnostics warnings", async () => {
  render(<WebexSpaceRebacPanel />);

  expect(await screen.findByText("Step 2a: Verify Webex Space ReBAC")).toBeInTheDocument();
  expect(await screen.findByText(/Plain space messages will be ignored/i)).toBeInTheDocument();
  expect(screen.getByText(/OpenFGA tuple read failed/i)).toBeInTheDocument();
});

it("fixes mention-only Webex runtime diagnostics by enabling all listen modes", async () => {
  render(<WebexSpaceRebacPanel />);

  fireEvent.click(await screen.findByRole("button", { name: /Fix agent:incident-agent routing/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-abc/routes",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"listen":"all"'),
      })
    )
  );
});

it("auto-fixes a Webex space with no routeable agent by creating the default association", async () => {
  const baseFetch = fetchMock.getMockImplementation();
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/diagnostics")) {
      return response({
        data: {
          openfga: { reachable: true, tuple_count: 0 },
          warnings: ["No OpenFGA space-agent tuples found. Webex runtime has no agent to dispatch."],
          routes: [],
          last_runtime_error: null,
        },
      });
    }
    if (url.endsWith("/routes") && init?.method === "PUT") {
      const body = JSON.parse(String(init.body ?? "{}"));
      return response({ data: { routes: body.routes } });
    }
    return baseFetch?.(url, init) ?? response({});
  });

  render(<WebexSpaceRebacPanel />);

  fireEvent.click(
    await screen.findByRole("button", { name: /Fix missing association with agent:incident-agent/i })
  );

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-abc/routes",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"agent_id":"incident-agent"'),
      })
    )
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-abc/routes",
    expect.objectContaining({
      method: "PUT",
      body: expect.stringContaining('"listen":"all"'),
    })
  );
});

it("edits and deletes Webex space-agent associations with metadata warning", async () => {
  const confirmSpy = jest.spyOn(window, "confirm");
  render(<WebexSpaceRebacPanel />);

  expect(await screen.findByRole("button", { name: /edit agent:incident-agent/i })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /edit agent:incident-agent/i }));
  fireEvent.change(screen.getByRole("combobox", { name: "Listen" }), {
    target: { value: "message" },
  });
  fireEvent.change(screen.getByLabelText("Priority"), {
    target: { value: "25" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Update Association" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-abc/routes",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"priority":25'),
      })
    )
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-abc/routes",
    expect.objectContaining({
      method: "PUT",
      body: expect.stringContaining('"listen":"message"'),
    })
  );

  await waitFor(() =>
    expect(screen.getByRole("button", { name: /delete agent:incident-agent/i })).toBeEnabled()
  );
  fireEvent.click(screen.getByRole("button", { name: /delete agent:incident-agent/i }));
  expect(confirmSpy).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(screen.getByText("Delete space-agent association?")).toBeInTheDocument()
  );
  expect(screen.getByText(/saved Mongo route metadata/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete association" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/WEBEX-WORKSPACE/space-abc/routes",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ agent_id: "incident-agent" }),
      })
    )
  );
});

it("applies Webex space association defaults for Webex spaces", async () => {
  const confirmSpy = jest.spyOn(window, "confirm");
  render(<WebexSpaceRebacPanel />);

  await screen.findByText("Step 2a: Verify Webex Space ReBAC");
  fireEvent.change(await screen.findByRole("combobox", { name: "Default Team" }), {
    target: { value: "platform-engineering" },
  });
  fireEvent.change(await screen.findByRole("combobox", { name: "Default Dynamic Agent" }), {
    target: { value: "incident-agent" },
  });
  const applyButton = screen.getByRole("button", { name: "Apply Defaults To Webex Spaces" });
  await waitFor(() => expect(applyButton).not.toBeDisabled());
  fireEvent.click(applyButton);

  expect(confirmSpy).not.toHaveBeenCalled();
  expect(await screen.findByRole("dialog", { name: "Apply Webex space association defaults?" })).toBeInTheDocument();
  expect(screen.getByText(/This will update 1 onboarded Webex space/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Apply defaults" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/defaults",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          team_slug: "platform-engineering",
          agent_id: "incident-agent",
          create_routes: true,
        }),
      })
    )
  );
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Webex space association defaults applied"),
      "success"
    )
  );
});

it("manually onboards a Webex space and applies defaults after admin consent", async () => {
  render(<WebexSpaceRebacPanel />);

  await screen.findByText("Step 2a: Verify Webex Space ReBAC");
  fireEvent.change(await screen.findByRole("combobox", { name: "Default Team" }), {
    target: { value: "platform-engineering" },
  });
  fireEvent.change(await screen.findByRole("combobox", { name: "Default Dynamic Agent" }), {
    target: { value: "incident-agent" },
  });
  fireEvent.change(screen.getByLabelText("Manual Space ID"), {
    target: { value: "space-manual-123" },
  });
  fireEvent.change(screen.getByLabelText("Manual Space Name"), {
    target: { value: "Manual Escalations" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Add Space & Apply Defaults" }));

  expect(
    await screen.findByRole("dialog", { name: "Add Webex space and apply defaults?" })
  ).toBeInTheDocument();
  expect(screen.getByText("space-manual-123")).toBeInTheDocument();
  expect(screen.getByText("Manual Escalations")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Apply space defaults" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/spaces/defaults",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"manual_spaces"'),
      })
    )
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/webex/spaces/defaults",
    expect.objectContaining({
      body: expect.stringContaining('"id":"space-manual-123"'),
    })
  );
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Webex manual space defaults applied"),
      "success"
    )
  );
});

it("labels Webex space association defaults and shows current configured values", async () => {
  render(<WebexSpaceRebacPanel />);

  expect(await screen.findByText("[Optional] Global Space Defaults")).toBeInTheDocument();
  expect(screen.queryByText("Migration Defaults")).not.toBeInTheDocument();
  expect(screen.getByText("Current default team")).toBeInTheDocument();
  expect(await screen.findByText("team:platform-engineering")).toBeInTheDocument();
  expect(screen.getByText("Current default Dynamic Agent")).toBeInTheDocument();
  expect(await screen.findByText("agent:incident-agent")).toBeInTheDocument();
});

it("shows Webex bot runtime sync status and triggers reload/config sync", async () => {
  render(<WebexSpaceRebacPanel />);

  expect(await screen.findByText("Advanced Setup - Import/Sync with Webex Bot")).toBeInTheDocument();
  expect(screen.getByText("db_prefer")).toBeInTheDocument();
  expect(screen.getByText(/1 cached space/i)).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Webex bot sync legend" })).toHaveTextContent(
    "Route mode: shows whether the Webex bot reads routes from database, YAML, or both."
  );

  fireEvent.click(screen.getByRole("button", { name: "Reload Bot Cache" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/runtime/reload",
      expect.objectContaining({ method: "POST" })
    )
  );

  fireEvent.click(screen.getByRole("button", { name: "Preview YAML Import" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/runtime/sync-from-config",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ dry_run: true }),
      })
    )
  );
  expect(await screen.findByText(/Sync preview: 1 routes planned/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Import from YAML Config" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/runtime/sync-from-config",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ dry_run: false }),
      })
    )
  );
  expect(await screen.findByText(/Config sync applied: upserted 1 routes/i)).toBeInTheDocument();
});

it("opens a runtime sync modal with preview progress and apply results", async () => {
  render(<WebexSpaceRebacPanel />);

  const previewButton = await screen.findByRole("button", { name: "Preview YAML Import" });
  await waitFor(() => expect(previewButton).toBeEnabled());
  fireEvent.click(previewButton);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/runtime/sync-from-config",
      expect.objectContaining({ method: "POST" })
    )
  );
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("Webex Bot Config Sync Preview")).toBeInTheDocument();
  expect(screen.getByText("Preview complete")).toBeInTheDocument();
  expect(screen.getByText("1 route planned")).toBeInTheDocument();
  expect(screen.getByText("1 space scanned")).toBeInTheDocument();
  expect(screen.getByText("0 routes upserted")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Import from YAML Config" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/webex/runtime/sync-from-config",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ dry_run: false }),
      })
    )
  );
  expect(await screen.findByText("Apply complete")).toBeInTheDocument();
  expect(screen.getByText("1 route upserted")).toBeInTheDocument();
  expect(screen.getByText("1 OpenFGA tuple written")).toBeInTheDocument();
});
