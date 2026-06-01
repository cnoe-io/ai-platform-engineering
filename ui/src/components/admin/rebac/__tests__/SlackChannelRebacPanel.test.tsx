import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const mockToast = jest.fn();
jest.mock("@/components/ui/toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

import { SlackChannelRebacPanel } from "../SlackChannelRebacPanel";
import { pickTeam } from "@/__test-utils__/team-picker";
import { pickAgent } from "@/__test-utils__/agent-picker";

const fetchMock = jest.fn();

beforeEach(() => {
  mockToast.mockClear();
  fetchMock.mockReset();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/slack/channels" || url === "/api/admin/slack/channels?health=1") {
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

async function switchToTab(name: "Configured channels" | "Onboard channels" | "Advanced") {
  const tab = await screen.findByRole("tab", { name });
  fireEvent.click(tab);
}

/**
 * Configured-channels are now a table that collapses by default; the
 * detail panel (diagnostics + agents form) renders inline only after
 * the row is expanded. Tests that interact with the detail panel must
 * expand the row first.
 */
async function expandChannelRow(channelName: string): Promise<void> {
  const row = (await screen.findByText(`#${channelName}`)).closest("tr");
  if (!row) throw new Error(`expandChannelRow: row for #${channelName} not found`);
  fireEvent.click(row);
}

it("uses enabled Dynamic Agents dropdown for Slack channel-agent associations", async () => {
  render(<SlackChannelRebacPanel />);

  // Configured channels appears twice on screen — as the CardTitle and as
  // the active tab button. Targeting the tab unambiguously also doubles
  // as a smoke test that the tab structure rendered.
  expect(await screen.findByRole("tab", { name: "Configured channels" })).toBeInTheDocument();
  expect(screen.queryByLabelText("Resource Type")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Action")).not.toBeInTheDocument();

  await expandChannelRow("incidents");
  // Only the route-agent AgentPicker is on screen on the default Configured tab —
  // the Preselected Dynamic Agent picker lives behind the Onboard tab now.
  expect(await screen.findByLabelText("Dynamic Agent")).toBeInTheDocument();

  await pickAgent("Dynamic Agent", "test-april-2025");
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

it("does not show legacy grant counts in the configured channels table", async () => {
  render(<SlackChannelRebacPanel />);

  // Channel rows live in the Configured Channels table now (replaced
  // the prior <select> dropdown).
  expect(await screen.findByText("#incidents")).toBeInTheDocument();
  expect(screen.queryByText(/0 grants/i)).not.toBeInTheDocument();
});

it("fixes stale Slack runtime diagnostics by deleting orphaned route metadata", async () => {
  render(<SlackChannelRebacPanel />);
  await expandChannelRow("incidents");

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
  await expandChannelRow("incidents");

  expect(await screen.findByText(/Plain channel messages will be ignored/i)).toBeInTheDocument();
  expect(screen.getByText(/OpenFGA tuple read failed/i)).toBeInTheDocument();
});

it("edits and deletes Slack channel-agent associations with metadata warning", async () => {
  const confirmSpy = jest.spyOn(window, "confirm");
  render(<SlackChannelRebacPanel />);
  await expandChannelRow("incidents");

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

  // saveRoute leaves loading=true until its loadChannels/loadDiagnostics
  // chain settles; clicking Delete while disabled is a silent no-op,
  // which is what stalled this test before. Wait for the button to
  // reactivate first.
  const deleteButton = await screen.findByRole("button", { name: /delete agent:incident-agent/i });
  await waitFor(() => expect(deleteButton).not.toBeDisabled());
  fireEvent.click(deleteButton);
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
  await switchToTab("Onboard channels");

  await screen.findByText("Default team and agent for new channels");
  // Preselected Team is now a searchable TeamPicker (2026-05-27).
  await screen.findByLabelText("Preselected Team");
  await pickTeam("Preselected Team", "platform-engineering");
  await pickAgent("Preselected Dynamic Agent", "incident-agent");

  expect(screen.queryByRole("button", { name: "Apply Selection to Managed Channels" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Refresh lists" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Create matching Slack routes when onboarding/i)).not.toBeInTheDocument();
});

it("discovers bot-member channels and applies defaults after admin consent", async () => {
  render(<SlackChannelRebacPanel />);
  await switchToTab("Onboard channels");

  await screen.findByLabelText("Preselected Team");
  await pickTeam("Preselected Team", "platform-engineering");
  await pickAgent("Preselected Dynamic Agent", "incident-agent");

  fireEvent.click(screen.getByRole("button", { name: "Find channels" }));

  expect(await screen.findByText(/2 bot-member channels discovered/i)).toBeInTheDocument();
  // Discovery no longer auto-selects rows.
  expect(screen.getByRole("checkbox", { name: /Import #incidents/i })).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: /Import #new-alerts/i })).not.toBeChecked();
  expect(
    screen.getByRole("status", {
      name: /2 bot-member found .* 1 new .* 1 in CAIPE .* 1 missing team/i,
    })
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refresh channels" })).toBeInTheDocument();

  // Admin opts in to both rows, then fills out the second row's picks.
  fireEvent.click(screen.getByRole("checkbox", { name: /Import #incidents/i }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Import #new-alerts/i }));
  expect(screen.getAllByText("Ready to set up").length).toBeGreaterThanOrEqual(2);
  expect(screen.queryByText("Configured")).not.toBeInTheDocument();
  // Per-row pickers are TeamPicker / AgentPicker.
  await pickTeam("Team for #new-alerts", "security");
  await pickAgent("Dynamic Agent for #new-alerts", "test-april-2025");

  fireEvent.click(screen.getByRole("button", { name: /^Set up \d+ channels?$/ }));

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
  await switchToTab("Onboard channels");

  const legacyDefaultsCheckbox = await screen.findByRole("checkbox", {
    name: /Use existing Slackbot channel agents as defaults/i,
  });
  expect(legacyDefaultsCheckbox).toBeChecked();

  fireEvent.click(screen.getByRole("button", { name: "Find channels" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith("/api/admin/slack/runtime/config-defaults", {
      cache: "no-store",
    })
  );
  expect(await screen.findByText(/2 bot-member channels discovered/i)).toBeInTheDocument();
  // AgentPicker is a button trigger; pre-fill renders the agent id inside.
  expect(screen.getByLabelText("Dynamic Agent for #new-alerts")).toHaveTextContent("test-april-2025");
  expect(screen.getByLabelText("Dynamic Agent for #incidents")).toHaveTextContent("incident-agent");
  expect(screen.queryByText("Configured")).not.toBeInTheDocument();
});

it("falls back to onboarding default when legacy config is ignored, and leaves agent unset otherwise", async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/slack/channels" || url === "/api/admin/slack/channels?health=1") {
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
  await switchToTab("Onboard channels");

  const discoverButton = await screen.findByRole("button", { name: "Find channels" });
  await waitFor(() => expect(discoverButton).not.toBeDisabled());
  fireEvent.click(discoverButton);
  expect(await screen.findByText(/2 bot-member channels discovered/i)).toBeInTheDocument();
  // AgentPicker shows its placeholder text when no value is selected.
  expect(screen.getByLabelText("Dynamic Agent for #new-alerts")).toHaveTextContent(/Select agent/);
  fireEvent.click(screen.getByRole("checkbox", { name: /Import #new-alerts/i }));
  expect(screen.getAllByText("Pick an agent").length).toBeGreaterThanOrEqual(1);

  await pickAgent("Preselected Dynamic Agent", "incident-agent");
  fireEvent.click(screen.getByRole("checkbox", { name: /Use existing Slackbot channel agents as defaults/i }));
  fireEvent.click(screen.getByRole("button", { name: "Refresh channels" }));

  await waitFor(() =>
    expect(screen.getByLabelText("Dynamic Agent for #new-alerts")).toHaveTextContent("incident-agent")
  );
});

it("discovers Slack channels even when no onboarding default team is configured", async () => {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/slack/channels" || url === "/api/admin/slack/channels?health=1") {
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
  await switchToTab("Onboard channels");

  const discoverButton = await screen.findByRole("button", { name: "Find channels" });
  await waitFor(() => expect(discoverButton).not.toBeDisabled());
  fireEvent.click(discoverButton);

  expect(await screen.findByText(/1 bot-member channel discovered/i)).toBeInTheDocument();
  // TeamPicker is a <button>, not a form control — assert the
  // empty-state placeholder is rendered on the trigger instead of
  // `.toHaveValue("")`.
  expect(screen.getByLabelText("Team for #new-alerts")).toHaveTextContent(/Select team/);
});

it("shows discovered channel setup feedback as a toast without shifting the action row", async () => {
  render(<SlackChannelRebacPanel />);
  await switchToTab("Onboard channels");

  await screen.findByLabelText("Preselected Team");
  await pickTeam("Preselected Team", "platform-engineering");
  await pickAgent("Preselected Dynamic Agent", "incident-agent");

  fireEvent.click(screen.getByRole("button", { name: "Find channels" }));

  expect(await screen.findByText(/2 bot-member channels discovered/i)).toBeInTheDocument();
  // Discovery no longer auto-selects rows — opt in explicitly before
  // setting team and agent.
  fireEvent.click(screen.getByRole("checkbox", { name: /Import #incidents/i }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Import #new-alerts/i }));
  await pickTeam("Team for #new-alerts", "security");
  await pickAgent("Dynamic Agent for #new-alerts", "test-april-2025");

  const applyButton = screen.getByRole("button", { name: /^Set up \d+ channels?$/ });
  fireEvent.click(applyButton);

  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Discovered defaults applied"),
      "success"
    )
  );
  expect(screen.queryByRole("dialog", { name: "Slack setup complete" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Refresh" })).toBeInTheDocument();
  expect(screen.queryByText("Ready to set up")).not.toBeInTheDocument();
  expect(screen.getAllByText("Configured").length).toBeGreaterThanOrEqual(2);
  expect(applyButton.parentElement).not.toHaveTextContent(/Channel setup applied/i);
});

it("uses a streamlined setup flow with icons and toast action confirmations", async () => {
  render(<SlackChannelRebacPanel />);

  // Channels view (default) shows the configured-channels table; the
  // diagnostics + agents detail panel collapses inline when a row is
  // expanded.
  expect(await screen.findByRole("tab", { name: "Configured channels" })).toBeInTheDocument();
  expect(await screen.findByText("#incidents")).toBeInTheDocument();
  await expandChannelRow("incidents");
  // The detail panel adds Diagnostics + Agents section labels alongside
  // the existing "Agents" table header — assert the buttons that only
  // appear inside the detail panel to disambiguate.
  expect(await screen.findByText("Diagnostics")).toBeInTheDocument();
  expect(await screen.findByLabelText("Dynamic Agent")).toBeInTheDocument();

  // Onboard view shows the defaults selector + Find channels button.
  await switchToTab("Onboard channels");
  expect(
    await screen.findByRole("heading", { name: "Default team and agent for new channels" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Find channels" })).toBeInTheDocument();

  // Advanced view exposes runtime status + YAML import controls.
  await switchToTab("Advanced");
  expect(
    await screen.findByRole("heading", { name: "Import from Slackbot YAML" }),
  ).toBeInTheDocument();
  const reloadButton = screen.getByRole("button", { name: "Reload Bot Cache" });
  await waitFor(() => expect(reloadButton).not.toBeDisabled());
  fireEvent.click(reloadButton);
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith("Slack bot route cache reloaded.", "success")
  );

  const importButton = screen.getByRole("button", { name: "Import from YAML Config" });
  fireEvent.click(importButton);
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith(
      expect.stringContaining("Config sync applied"),
      "success"
    )
  );
});

it("organizes Slack admin into Configured / Onboard / Advanced tabs", async () => {
  render(<SlackChannelRebacPanel />);

  expect(await screen.findByRole("tab", { name: "Configured channels" })).toBeInTheDocument();

  // Configured tab is selected by default.
  expect(screen.getByRole("tab", { name: "Configured channels" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.getByRole("region", { name: "Configured Slack channels" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Default team and agent for new channels" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Advanced Setup - Import/Sync with Slackbot" }),
  ).not.toBeInTheDocument();

  // Onboard tab swaps in defaults + wizard, hides the configured table.
  await switchToTab("Onboard channels");
  expect(
    await screen.findByRole("region", { name: "Default team and agent for new channels" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Find channels" })).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Configured Slack channels" }),
  ).not.toBeInTheDocument();

  // Advanced tab shows runtime status + YAML import controls only.
  await switchToTab("Advanced");
  expect(
    await screen.findByRole("region", { name: "Advanced Setup - Import/Sync with Slackbot" }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("region", { name: "Default team and agent for new channels" }),
  ).not.toBeInTheDocument();
});

it("labels Slack onboarding default selection and shows current configured values", async () => {
  render(<SlackChannelRebacPanel />);
  await switchToTab("Onboard channels");

  expect(screen.queryByText("Migration Defaults")).not.toBeInTheDocument();
  // The "Last saved" panel was refactored on 2026-05-27 to a single
  // row with "Onboarding team" / "Onboarding Dynamic Agent" sub-labels
  // and a dedicated "Save defaults" button. Scope to that row so the
  // TeamPicker trigger (which also renders `team:<slug>` text) doesn't
  // collide with these assertions.
  const savedTeamLabel = await screen.findByText("Onboarding team");
  // Scope to the "Last saved" info box (two levels up from the label text) to
  // avoid colliding with TeamPicker's trigger which also renders "team:<slug>".
  const savedInfoBox = savedTeamLabel.closest("div")?.parentElement?.parentElement;
  expect(savedInfoBox).toBeTruthy();
  expect(within(savedInfoBox!).getByText("team:platform-engineering")).toBeInTheDocument();
  expect(within(savedInfoBox!).getByText("Onboarding Dynamic Agent")).toBeInTheDocument();
  expect(within(savedInfoBox!).getByText("agent:incident-agent")).toBeInTheDocument();
  // Save button starts disabled because form picks match saved values.
  expect(
    screen.getByRole("button", { name: "Save Slack onboarding defaults" }),
  ).toBeDisabled();
  expect(screen.queryByText("[Optional] Global Channel Defaults")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Apply Selection to Managed Channels" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Refresh lists" })).not.toBeInTheDocument();
});

it("shows Slack bot runtime sync status and triggers reload/config sync", async () => {
  render(<SlackChannelRebacPanel />);
  await switchToTab("Advanced");

  expect(await screen.findByRole("heading", { name: "Import from Slackbot YAML" })).toBeInTheDocument();
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

  // Reload sets loading=true which disables Preview YAML Import; wait
  // for the click to take effect before firing the next one.
  const previewButton = screen.getByRole("button", { name: "Preview YAML Import" });
  await waitFor(() => expect(previewButton).not.toBeDisabled());
  fireEvent.click(previewButton);
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

  const importButton = screen.getByRole("button", { name: "Import from YAML Config" });
  await waitFor(() => expect(importButton).not.toBeDisabled());
  fireEvent.click(importButton);
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
  await switchToTab("Advanced");

  fireEvent.click(await screen.findByRole("button", { name: "Preview YAML Import" }));

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("Slack Bot Config Sync Preview")).toBeInTheDocument();
  expect(await screen.findByText("Preview complete")).toBeInTheDocument();
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

function mockMinimalSlackPanel(defaults: {
  team_slug?: string;
  agent_id?: string;
  source?: "db" | "env" | "unset";
  updated_at?: string;
  updated_by?: string;
}) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === "/api/admin/slack/channels" || url === "/api/admin/slack/channels?health=1") {
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
    if (url === "/api/admin/slack/channels/defaults" && init?.method === "PUT") {
      const body = JSON.parse(String(init.body ?? "{}"));
      return response({
        data: {
          defaults: {
            ...defaults,
            ...body,
            source: "db",
            updated_at: "2026-05-27T08:00:00.000Z",
            updated_by: "admin@example.com",
          },
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
  await switchToTab("Onboard channels");

  // When the stale agent is detected, AgentPicker falls back to placeholder.
  const agentTrigger = await screen.findByLabelText("Preselected Dynamic Agent");
  await waitFor(() => expect(agentTrigger).toHaveTextContent(/Select preselected Dynamic Agent/));

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
  await switchToTab("Onboard channels");

  // TeamPicker is a <button> now (2026-05-27 — switched from native
  // <select> to a searchable popover). When the persisted slug
  // doesn't match any current team, the picker falls back to its
  // placeholder text so the admin sees "Select preselected team"
  // instead of a dangling value.
  const teamTrigger = await screen.findByLabelText("Preselected Team");
  await waitFor(() => expect(teamTrigger).toHaveTextContent(/Select preselected team/));

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

// Save defaults flow (2026-05-27): admins picked a team/agent in the
// UI but the choice never persisted — the GET only returned env vars
// and the migration POST didn't write the saved defaults anywhere.
// The new PUT /api/admin/slack/channels/defaults route writes to
// `platform_config` and the panel exposes a dedicated "Save defaults"
// button that lights up only when the form diverges from the saved
// values. This test pins that contract.
it("persists Slack onboarding defaults via PUT when the admin clicks Save defaults", async () => {
  mockMinimalSlackPanel({
    team_slug: "",
    agent_id: "",
    source: "unset",
  });

  render(<SlackChannelRebacPanel />);
  await switchToTab("Onboard channels");

  const saveButton = await screen.findByRole("button", {
    name: "Save Slack onboarding defaults",
  });
  // Nothing changed yet → button disabled, no dirty marker.
  expect(saveButton).toBeDisabled();
  expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();

  await pickTeam("Preselected Team", "platform-engineering");
  await pickAgent("Preselected Dynamic Agent", "incident-agent");

  // Dirty → button enabled and "Unsaved changes" badge visible.
  await waitFor(() => expect(saveButton).toBeEnabled());
  expect(screen.getByText("Unsaved changes")).toBeInTheDocument();

  fireEvent.click(saveButton);

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/slack/channels/defaults",
      expect.objectContaining({
        method: "PUT",
        body: expect.stringContaining('"team_slug":"platform-engineering"'),
      }),
    ),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/admin/slack/channels/defaults",
    expect.objectContaining({
      method: "PUT",
      body: expect.stringContaining('"agent_id":"incident-agent"'),
    }),
  );

  // After save the response updates `configuredDefaults`, so the
  // form re-matches the saved values, the button disables again, and
  // the dirty marker disappears. The "Last saved" line picks up the
  // returned timestamp + actor.
  await waitFor(() => expect(saveButton).toBeDisabled());
  expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  expect(screen.getByText(/admin@example.com/)).toBeInTheDocument();
  await waitFor(() =>
    expect(mockToast).toHaveBeenCalledWith("Onboarding defaults saved.", "success"),
  );
});
