import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mockToast = jest.fn();
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { SlackChannelRebacPanel } from "../SlackChannelRebacPanel";

const fetchMock = jest.fn();

beforeEach(() => {
  mockToast.mockClear();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/slack/channels") {
      return response({
        data: {
          channels: [
            {
              workspace_id: "T123456789",
              channel_id: "C123456789",
              channel_name: "incidents",
              active_grants: 0,
            },
          ],
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
            { _id: "team-2", slug: "security", name: "Security" },
          ],
        },
      });
    }
    if (url === "/api/admin/slack/channels/defaults" && init?.method === "POST") {
      return response({
        data: {
          summary: {
            channels_seen: 1,
            channels_assigned_team: 1,
            channel_grants_ensured: 1,
            routes_ensured: 1,
          },
        },
      });
    }
    if (url === "/api/admin/slack/channels/defaults") {
      return response({
        data: {
          defaults: {
            team_slug: "platform-engineering",
            agent_id: "incident-agent",
          },
        },
      });
    }
    if (url === "/api/admin/slack/runtime/status") {
      return response({
        data: {
          route_mode: "db_prefer",
          static_config: { channels: 1, routes: 1 },
          route_cache: { ttl_seconds: 60, cache_size: 1, cached_channels: ["CAIPE/C123456789"] },
          last_sync: null,
        },
      });
    }
    if (url === "/api/admin/slack/runtime/config-defaults") {
      return response({
        data: {
          workspace_id: "T123456789",
          channels_seen: 2,
          routes_seen: 2,
          channels: {
            C123456789: {
              workspace_id: "T123456789",
              channel_id: "C123456789",
              channel_name: "#incidents",
              agents: [{ agent_id: "incident-agent", priority: 100 }],
              suggested_agent_id: "incident-agent",
            },
            CNEWMISSING: {
              workspace_id: "T123456789",
              channel_id: "CNEWMISSING",
              channel_name: "#new-alerts",
              agents: [{ agent_id: "test-april-2025", priority: 100 }],
              suggested_agent_id: "test-april-2025",
            },
          },
        },
      });
    }
    if (url === "/api/admin/slack/runtime/reload") {
      return response({ data: { reloaded: "all" } });
    }
    if (url === "/api/admin/slack/runtime/sync-from-config") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      return response({
        data: {
          dry_run: Boolean(body.dry_run),
          channels_seen: 1,
          routes_planned: 1,
          routes_upserted: body.dry_run ? 0 : 1,
          openfga_tuples_written: body.dry_run ? 0 : 1,
        },
      });
    }
    if (url.startsWith("/api/admin/slack/available-channels")) {
      return response({
        data: {
          channels: [
            {
              id: "C123456789",
              name: "incidents",
              is_private: false,
              is_member: true,
              num_members: 10,
            },
            {
              id: "CNEWMISSING",
              name: "new-alerts",
              is_private: false,
              is_member: true,
              num_members: 7,
            },
          ],
          total_matches: 2,
          total_visible: 2,
          next_cursor: null,
          has_more: false,
          cached: false,
          fetched_at: Date.now(),
          query: { q: "", member_only: true, limit: 500 },
        },
      });
    }
    if (url.endsWith("/resources") && init?.method === "PUT") {
      return response({ data: { grants: [{ resource: { type: "agent", id: "test-april-2025" }, actions: ["use"], status: "active" }] } });
    }
    if (url.endsWith("/resources")) {
      return response({ data: { grants: [] } });
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
            "Route agent:incident-agent only listens to mentions. Plain channel messages will be ignored.",
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
              warnings: ["Plain channel messages will be ignored."],
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

it("uses enabled Dynamic Agents dropdown for Slack channel-agent associations", async () => {
  render(<SlackChannelRebacPanel />);

  expect(
    await screen.findByText(/OpenFGA is the source of truth/i)
  ).toBeInTheDocument();
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
      "/api/admin/slack/channels/T123456789/C123456789/routes",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"agent_id":"test-april-2025"'),
      })
    )
  );
});

it("does not show legacy grant counts in the Slack channel dropdown", async () => {
  render(<SlackChannelRebacPanel />);

  const channelSelect = await screen.findByRole("combobox", { name: "Channel" });

  expect(channelSelect).toBeInTheDocument();
  expect(screen.getByRole("option", { name: "incidents" })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /0 grants/i })).not.toBeInTheDocument();
});

it("fixes stale Slack runtime diagnostics by deleting orphaned route metadata", async () => {
  render(<SlackChannelRebacPanel />);

  fireEvent.click(await screen.findByRole("button", { name: /Fix agent:foo-bar routing/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/slack/channels/T123456789/C123456789/routes",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ agent_id: "foo-bar" }),
      })
    )
  );
});

it("surfaces Slack runtime diagnostics warnings", async () => {
  render(<SlackChannelRebacPanel />);

  expect(await screen.findByText("Step 2a: Verify Slack Channel ReBAC")).toBeInTheDocument();
  expect(await screen.findByText(/Plain channel messages will be ignored/i)).toBeInTheDocument();
  expect(screen.getByText(/OpenFGA tuple read failed/i)).toBeInTheDocument();
});

it("fixes mention-only Slack runtime diagnostics by enabling all listen modes", async () => {
  render(<SlackChannelRebacPanel />);

  fireEvent.click(await screen.findByRole("button", { name: /Fix agent:incident-agent routing/i }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/slack/channels/T123456789/C123456789/routes",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"listen":"all"'),
      })
    )
  );
});

it("edits and deletes Slack channel-agent associations with metadata warning", async () => {
  const confirmSpy = jest.spyOn(window, "confirm");
  render(<SlackChannelRebacPanel />);

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
      "/api/admin/slack/channels/T123456789/C123456789/routes",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"priority":25'),
      })
    )
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/slack/channels/T123456789/C123456789/routes",
    expect.objectContaining({
      method: "PUT",
      body: expect.stringContaining('"listen":"message"'),
    })
  );

  fireEvent.click(screen.getByRole("button", { name: /delete agent:incident-agent/i }));
  expect(confirmSpy).not.toHaveBeenCalled();
  expect(await screen.findByRole("dialog", { name: "Delete channel-agent association?" })).toBeInTheDocument();
  expect(screen.getByText(/saved Mongo route metadata/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Delete association" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/slack/channels/T123456789/C123456789/routes",
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ agent_id: "incident-agent" }),
      })
    )
  );
});

it("keeps Slack onboarding defaults simple without bulk apply controls", async () => {
  render(<SlackChannelRebacPanel />);

  await screen.findByText("Onboarding Default Selection");
  fireEvent.change(await screen.findByRole("combobox", { name: "Preselected Team" }), {
    target: { value: "platform-engineering" },
  });
  fireEvent.change(await screen.findByRole("combobox", { name: "Preselected Dynamic Agent" }), {
    target: { value: "incident-agent" },
  });

  expect(screen.queryByRole("button", { name: "Apply Selection to Managed Channels" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Refresh lists" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Create matching Slack routes when onboarding/i)).not.toBeInTheDocument();
});

it("discovers bot-member channels and applies defaults after admin consent", async () => {
  render(<SlackChannelRebacPanel />);

  await screen.findByText("Step 2a: Verify Slack Channel ReBAC");
  fireEvent.change(await screen.findByRole("combobox", { name: "Preselected Team" }), {
    target: { value: "platform-engineering" },
  });
  fireEvent.change(await screen.findByRole("combobox", { name: "Preselected Dynamic Agent" }), {
    target: { value: "incident-agent" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Find Slack Channels with Bot Integration" }));

  expect(screen.queryByRole("dialog", { name: "Review channels found by the bot" })).not.toBeInTheDocument();
  expect(await screen.findByText(/2 bot-member channels discovered/i)).toBeInTheDocument();
  expect(screen.getByText(/Select channels to import, then choose team and Dynamic Agent per channel/i)).toBeInTheDocument();
  expect(screen.getByText("Onboarding path")).toBeInTheDocument();
  expect(screen.getAllByText("Needs setup").length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText("Already managed")).not.toBeInTheDocument();
  expect(
    screen.getByRole("status", {
      name: /2 bot-visible found .* 1 new .* 1 in CAIPE .* 1 missing team/i,
    })
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refresh Slack Channels with Bot Integration" })).toBeInTheDocument();

  expect(screen.getByRole("checkbox", { name: /Import #incidents/i })).toBeChecked();
  fireEvent.change(screen.getByLabelText("Team for #new-alerts"), {
    target: { value: "security" },
  });
  fireEvent.change(screen.getByLabelText("Dynamic Agent for #new-alerts"), {
    target: { value: "test-april-2025" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Set up selected Slack channels" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/slack/available-channels?"),
      expect.anything()
    )
  );
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/slack/channels/defaults",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"channel_defaults"'),
      })
    )
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/slack/channels/defaults",
    expect.objectContaining({
      body: expect.stringContaining('"id":"CNEWMISSING"'),
    })
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/slack/channels/defaults",
    expect.objectContaining({
      body: expect.stringContaining('"id":"C123456789"'),
    })
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/slack/channels/defaults",
    expect.objectContaining({
      body: expect.stringContaining('"team_slug":"security"'),
    })
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/slack/channels/defaults",
    expect.objectContaining({
      body: expect.stringContaining('"agent_id":"test-april-2025"'),
    })
  );
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Discovered defaults applied"),
      "success"
    )
  );
});

it("prefills discovered Slack channels from legacy Slackbot config by default", async () => {
  render(<SlackChannelRebacPanel />);

  await screen.findByText("Step 2a: Verify Slack Channel ReBAC");
  const legacyDefaultsCheckbox = screen.getByRole("checkbox", {
    name: /Use existing Slackbot channel agents as defaults/i,
  });
  expect(legacyDefaultsCheckbox).toBeChecked();

  fireEvent.click(screen.getByRole("button", { name: "Find Slack Channels with Bot Integration" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/slack/runtime/config-defaults", {
      cache: "no-store",
    })
  );
  expect(await screen.findByText(/2 bot-member channels discovered/i)).toBeInTheDocument();
  expect(screen.getByLabelText("Dynamic Agent for #new-alerts")).toHaveValue("test-april-2025");
  expect(screen.getByLabelText("Dynamic Agent for #incidents")).toHaveValue("incident-agent");
  expect(screen.getAllByText("Needs setup").length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText("Already managed")).not.toBeInTheDocument();
});

it("falls back to onboarding default and then alphabetical agent when legacy config is ignored or unavailable", async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/slack/channels") {
      return response({
        data: {
          channels: [
            {
              workspace_id: "T123456789",
              channel_id: "C123456789",
              channel_name: "incidents",
              active_grants: 0,
            },
          ],
        },
      });
    }
    if (url === "/api/dynamic-agents?enabled_only=true") {
      return response({
        data: {
          items: [
            { _id: "zeta-agent", name: "Zeta Agent" },
            { _id: "alpha-agent", name: "Alpha Agent" },
            { _id: "incident-agent", name: "Incident Agent" },
          ],
        },
      });
    }
    if (url === "/api/admin/teams") {
      return response({
        data: {
          teams: [{ _id: "team-1", slug: "platform-engineering", name: "Platform Engineering" }],
        },
      });
    }
    if (url === "/api/admin/slack/channels/defaults") {
      return response({ data: { defaults: { team_slug: "platform-engineering" } } });
    }
    if (url === "/api/admin/slack/runtime/status") {
      return response({
        data: {
          route_mode: "db_prefer",
          static_config: { channels: 1, routes: 1 },
          route_cache: { ttl_seconds: 60, cache_size: 1, cached_channels: ["CAIPE/C123456789"] },
          last_sync: null,
        },
      });
    }
    if (url === "/api/admin/slack/runtime/config-defaults") {
      return response({
        data: {
          workspace_id: "T123456789",
          channels_seen: 1,
          routes_seen: 1,
          channels: {
            CNEWMISSING: {
              workspace_id: "T123456789",
              channel_id: "CNEWMISSING",
              channel_name: "#new-alerts",
              agents: [{ agent_id: "legacy-missing-from-caipe", priority: 100 }],
              suggested_agent_id: "legacy-missing-from-caipe",
            },
          },
        },
      });
    }
    if (url.startsWith("/api/admin/slack/available-channels")) {
      return response({
        data: {
          channels: [
            { id: "C123456789", name: "incidents", is_private: false, is_member: true, num_members: 10 },
            { id: "CNEWMISSING", name: "new-alerts", is_private: false, is_member: true, num_members: 7 },
          ],
          next_cursor: null,
          has_more: false,
        },
      });
    }
    if (url.endsWith("/resources")) {
      return response({ data: { grants: [] } });
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
          warnings: [],
          routes: [],
          last_runtime_error: null,
        },
      });
    }
    return response({});
  });

  render(<SlackChannelRebacPanel />);

  await screen.findByText("Step 2a: Verify Slack Channel ReBAC");
  const discoverButton = screen.getByRole("button", { name: "Find Slack Channels with Bot Integration" });
  await waitFor(() => expect(discoverButton).not.toBeDisabled());
  fireEvent.click(discoverButton);
  expect(await screen.findByText(/2 bot-member channels discovered/i)).toBeInTheDocument();
  expect(screen.getByLabelText("Dynamic Agent for #new-alerts")).toHaveValue("alpha-agent");

  fireEvent.change(screen.getByRole("combobox", { name: "Preselected Dynamic Agent" }), {
    target: { value: "incident-agent" },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: /Use existing Slackbot channel agents as defaults/i }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh Slack Channels with Bot Integration" }));

  await waitFor(() =>
    expect(screen.getByLabelText("Dynamic Agent for #new-alerts")).toHaveValue("incident-agent")
  );
});

it("discovers Slack channels even when no onboarding default team is configured", async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/slack/channels") {
      return response({ data: { channels: [] } });
    }
    if (url === "/api/dynamic-agents?enabled_only=true") {
      return response({
        data: {
          items: [{ _id: "incident-agent", name: "Incident Agent" }],
        },
      });
    }
    if (url === "/api/admin/teams") {
      return response({
        data: {
          teams: [{ _id: "team-1", slug: "platform-engineering", name: "Platform Engineering" }],
        },
      });
    }
    if (url === "/api/admin/slack/channels/defaults") {
      return response({ data: { defaults: {} } });
    }
    if (url === "/api/admin/slack/runtime/status") {
      return response({
        data: {
          route_mode: "db_prefer",
          static_config: { channels: 0, routes: 0 },
          route_cache: { ttl_seconds: 60, cache_size: 0, cached_channels: [] },
          last_sync: null,
        },
      });
    }
    if (url === "/api/admin/slack/runtime/config-defaults") {
      return response({ data: { workspace_id: "T123456789", channels_seen: 0, routes_seen: 0, channels: {} } });
    }
    if (url.startsWith("/api/admin/slack/available-channels")) {
      return response({
        data: {
          channels: [
            { id: "CNEWMISSING", name: "new-alerts", is_private: false, is_member: true, num_members: 7 },
          ],
          next_cursor: null,
          has_more: false,
        },
      });
    }
    if (url.endsWith("/resources")) {
      return response({ data: { grants: [] } });
    }
    if (url.endsWith("/routes")) {
      return response({ data: { routes: [] } });
    }
    if (url.endsWith("/diagnostics")) {
      return response({
        data: {
          openfga: { reachable: true, tuple_count: 0 },
          warnings: [],
          routes: [],
          last_runtime_error: null,
        },
      });
    }
    return response({});
  });

  render(<SlackChannelRebacPanel />);

  await screen.findByText("Step 2a: Verify Slack Channel ReBAC");
  const discoverButton = screen.getByRole("button", { name: "Find Slack Channels with Bot Integration" });
  await waitFor(() => expect(discoverButton).not.toBeDisabled());
  fireEvent.click(discoverButton);

  expect(await screen.findByText(/1 bot-member channel discovered/i)).toBeInTheDocument();
  expect(screen.getByLabelText("Team for #new-alerts")).toHaveValue("");
});

it("shows discovered channel setup feedback as a toast without shifting the action row", async () => {
  render(<SlackChannelRebacPanel />);

  await screen.findByText("Step 2a: Verify Slack Channel ReBAC");
  fireEvent.change(await screen.findByRole("combobox", { name: "Preselected Team" }), {
    target: { value: "platform-engineering" },
  });
  fireEvent.change(await screen.findByRole("combobox", { name: "Preselected Dynamic Agent" }), {
    target: { value: "incident-agent" },
  });

  fireEvent.click(screen.getByRole("button", { name: "Find Slack Channels with Bot Integration" }));

  expect(await screen.findByText(/2 bot-member channels discovered/i)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Team for #new-alerts"), {
    target: { value: "security" },
  });
  fireEvent.change(screen.getByLabelText("Dynamic Agent for #new-alerts"), {
    target: { value: "test-april-2025" },
  });

  const applyButton = screen.getByRole("button", { name: "Set up selected Slack channels" });
  fireEvent.click(applyButton);

  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Discovered defaults applied"),
      "success"
    )
  );
  expect(screen.queryByRole("dialog", { name: "Slack setup complete" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refresh setup status" })).toBeInTheDocument();
  expect(screen.queryByText("Needs setup")).not.toBeInTheDocument();
  expect(screen.getAllByText("Already managed").length).toBeGreaterThanOrEqual(2);
  expect(applyButton.parentElement).not.toHaveTextContent(/Channel setup applied/i);
});

it("uses a streamlined setup flow with icons and toast action confirmations", async () => {
  render(<SlackChannelRebacPanel />);

  expect(await screen.findByText("Slack Channel Setup")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Step 1: Discover and Setup" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Step 2a: Verify Slack Channel ReBAC" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Step 2b: Specify agent priority" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Onboarding Default Selection" })).toBeInTheDocument();
  expect(screen.getByText(/Only changes what is preselected when you onboard channels/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Find Slack Channels with Bot Integration" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Discover & Apply Defaults" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import from YAML Config" })).toBeInTheDocument();

  const reloadButton = screen.getByRole("button", { name: "Reload Bot Cache" });
  await waitFor(() => expect(reloadButton).not.toBeDisabled());
  fireEvent.click(reloadButton);
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith("Slack bot route cache reloaded.", "success")
  );
  expect(reloadButton.parentElement).not.toHaveTextContent("Bot cache reloaded");

  const importButton = screen.getByRole("button", { name: "Import from YAML Config" });
  fireEvent.click(importButton);
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Config sync applied"),
      "success"
    )
  );
  expect(importButton.parentElement).not.toHaveTextContent("YAML config imported");
});

it("lays out Slack setup as five subtly tinted sections in the requested order", async () => {
  render(<SlackChannelRebacPanel />);

  expect(await screen.findByText("Slack Channel Setup")).toBeInTheDocument();
  fireEvent.change(await screen.findByRole("combobox", { name: "Preselected Team" }), {
    target: { value: "platform-engineering" },
  });
  fireEvent.change(await screen.findByRole("combobox", { name: "Preselected Dynamic Agent" }), {
    target: { value: "incident-agent" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Find Slack Channels with Bot Integration" }));

  const sections = [
    await screen.findByRole("region", { name: "Step 1: Discover and Setup" }),
    screen.getByRole("region", { name: "Step 2a: Verify Slack Channel ReBAC" }),
    screen.getByRole("region", { name: "Step 2b: Specify agent priority" }),
    screen.getByRole("region", { name: "Onboarding Default Selection" }),
    screen.getByRole("region", { name: "Advanced Setup - Import/Sync with Slackbot" }),
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
  expect(within(sections[0]).getByRole("heading", { name: "Step 1: Discover and Setup" })).toBeInTheDocument();
  expect(within(sections[1]).getAllByRole("heading")[0]).toHaveTextContent("Step 2a: Verify Slack Channel ReBAC");
  expect(sections[0]).toHaveTextContent("Review channels found by the bot");
  expect(sections[1]).toHaveTextContent("Selected Scope");
  expect(sections[1]).toHaveTextContent("Verify Slack Channel ReBAC");
  expect(sections[2]).toHaveTextContent("Specify agent priority");
  expect(sections[4]).toHaveTextContent("Import from YAML Config");
});

it("labels Slack onboarding default selection and shows current configured values", async () => {
  render(<SlackChannelRebacPanel />);

  expect(await screen.findByText("Slack Channel Setup")).toBeInTheDocument();
  expect(screen.queryByText("Migration Defaults")).not.toBeInTheDocument();
  expect(screen.getByText("Saved onboarding team")).toBeInTheDocument();
  expect(await screen.findByText("team:platform-engineering")).toBeInTheDocument();
  expect(screen.getByText("Saved onboarding Dynamic Agent")).toBeInTheDocument();
  expect(screen.getByText("agent:incident-agent")).toBeInTheDocument();
  expect(screen.queryByText("[Optional] Global Channel Defaults")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Apply Selection to Managed Channels" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Refresh lists" })).not.toBeInTheDocument();
});

it("shows Slack bot runtime sync status and triggers reload/config sync", async () => {
  render(<SlackChannelRebacPanel />);

  expect(await screen.findByText("Advanced Setup - Import/Sync with Slackbot")).toBeInTheDocument();
  expect(screen.getByText("db_prefer")).toBeInTheDocument();
  expect(screen.getByText(/1 cached channel/i)).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Slackbot sync legend" })).toHaveTextContent(
    "Route mode: shows whether the Slackbot reads routes from database, YAML, or both."
  );
  expect(screen.getByRole("region", { name: "Slackbot sync legend" })).toHaveTextContent(
    "Reload Bot Cache: refreshes the running bot after UI route changes."
  );
  expect(screen.getByRole("region", { name: "Slackbot sync legend" })).toHaveTextContent(
    "Preview YAML Import: shows planned changes without writing them."
  );
  expect(screen.getByRole("region", { name: "Slackbot sync legend" })).toHaveTextContent(
    "Import from YAML Config: writes YAML routes into CAIPE/OpenFGA."
  );

  fireEvent.click(screen.getByRole("button", { name: "Reload Bot Cache" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/slack/runtime/reload",
      expect.objectContaining({ method: "POST" })
    )
  );

  fireEvent.click(screen.getByRole("button", { name: "Preview YAML Import" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/slack/runtime/sync-from-config",
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
      "/api/admin/slack/runtime/sync-from-config",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ dry_run: false }),
      })
    )
  );
  expect(await screen.findByText(/Config sync applied: upserted 1 routes/i)).toBeInTheDocument();
});

it("opens a runtime sync modal with preview progress and apply results", async () => {
  render(<SlackChannelRebacPanel />);

  fireEvent.click(await screen.findByRole("button", { name: "Preview YAML Import" }));

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("Slack Bot Config Sync Preview")).toBeInTheDocument();
  expect(screen.getByText("Preview complete")).toBeInTheDocument();
  expect(screen.getByText("1 route planned")).toBeInTheDocument();
  expect(screen.getByText("1 channel scanned")).toBeInTheDocument();
  expect(screen.getByText("0 routes upserted")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Import from YAML Config" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/slack/runtime/sync-from-config",
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

function mockMinimalSlackPanel(defaults: { team_slug?: string; agent_id?: string }) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/admin/slack/channels") {
      return response({ data: { channels: [] } });
    }
    if (url === "/api/dynamic-agents?enabled_only=true") {
      return response({
        data: { items: [{ _id: "incident-agent", name: "Incident Agent" }] },
      });
    }
    if (url === "/api/admin/teams") {
      return response({
        data: {
          teams: [{ _id: "team-1", slug: "platform-engineering", name: "Platform Engineering" }],
        },
      });
    }
    if (url === "/api/admin/slack/channels/defaults") {
      return response({ data: { defaults } });
    }
    if (url === "/api/admin/slack/runtime/status") {
      return response({
        data: {
          route_mode: "db_prefer",
          static_config: { channels: 0, routes: 0 },
          route_cache: { ttl_seconds: 60, cache_size: 0, cached_channels: [] },
          last_sync: null,
        },
      });
    }
    if (url === "/api/admin/slack/runtime/config-defaults") {
      return response({
        data: { workspace_id: "T123456789", channels_seen: 0, routes_seen: 0, channels: {} },
      });
    }
    if (url.startsWith("/api/admin/slack/available-channels")) {
      return response({
        data: { channels: [], next_cursor: null, has_more: false },
      });
    }
    if (url.endsWith("/resources")) {
      return response({ data: { grants: [] } });
    }
    if (url.endsWith("/routes")) {
      return response({ data: { routes: [] } });
    }
    if (url.endsWith("/diagnostics")) {
      return response({
        data: {
          openfga: { reachable: true, tuple_count: 0 },
          warnings: [],
          routes: [],
          last_runtime_error: null,
        },
      });
    }
    return response({});
  });
}

// Regression for the silent-no-op stale-env-default bug: a SLACK_DEFAULT_AGENT_ID
// or SLACK_DEFAULT_TEAM_SLUG that no longer matches a real, enabled record used
// to be silently submitted by the apply button, causing the API to 404 with
// "Default Dynamic Agent <id> was not found or is disabled". The fix drops the
// stale value back to "" once dynamicAgents/teams load and shows a visible
// amber warning telling the admin which env value was rejected.
it("clears stale env-provided default Dynamic Agent and warns the admin", async () => {
  mockMinimalSlackPanel({ team_slug: "platform-engineering", agent_id: "ghost-agent" });

  render(<SlackChannelRebacPanel />);

  const agentSelect = (await screen.findByRole("combobox", {
    name: "Preselected Dynamic Agent",
  })) as HTMLSelectElement;
  await waitFor(() => expect(agentSelect.value).toBe(""));

  await waitFor(() => {
    const alerts = screen.queryAllByRole("alert");
    const warning = alerts.find(
      (alert) =>
        (alert.textContent ?? "").includes("saved default Dynamic Agent") &&
        (alert.textContent ?? "").includes("ghost-agent")
    );
    expect(warning).toBeDefined();
    expect(warning!.textContent).toMatch(/SLACK_DEFAULT_AGENT_ID/);
  });
});

it("clears stale env-provided default Team and warns the admin", async () => {
  mockMinimalSlackPanel({ team_slug: "deleted-team", agent_id: "incident-agent" });

  render(<SlackChannelRebacPanel />);

  const teamSelect = (await screen.findByRole("combobox", {
    name: "Preselected Team",
  })) as HTMLSelectElement;
  await waitFor(() => expect(teamSelect.value).toBe(""));

  await waitFor(() => {
    const alerts = screen.queryAllByRole("alert");
    const warning = alerts.find(
      (alert) =>
        (alert.textContent ?? "").includes("saved default team") &&
        (alert.textContent ?? "").includes("deleted-team")
    );
    expect(warning).toBeDefined();
    expect(warning!.textContent).toMatch(/SLACK_DEFAULT_TEAM_SLUG/);
  });
});
