import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SlackChannelRebacPanel } from "../SlackChannelRebacPanel";

const fetchMock = jest.fn();

beforeEach(() => {
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

  expect(await screen.findByText("Slack Runtime Diagnostics")).toBeInTheDocument();
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

it("applies Slack channel association defaults for Slack channels", async () => {
  const confirmSpy = jest.spyOn(window, "confirm");
  render(<SlackChannelRebacPanel />);

  await screen.findByText("Slack Runtime Diagnostics");
  fireEvent.change(await screen.findByRole("combobox", { name: "Default Team" }), {
    target: { value: "platform-engineering" },
  });
  fireEvent.change(await screen.findByRole("combobox", { name: "Default Dynamic Agent" }), {
    target: { value: "incident-agent" },
  });
  const applyButton = screen.getByRole("button", { name: "Apply Defaults To Slack Channels" });
  await waitFor(() => expect(applyButton).not.toBeDisabled());
  fireEvent.click(applyButton);

  expect(confirmSpy).not.toHaveBeenCalled();
  expect(await screen.findByRole("dialog", { name: "Apply Slack channel association defaults?" })).toBeInTheDocument();
  expect(screen.getByText(/This will update 1 onboarded Slack channel/i)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Apply defaults" }));

  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/slack/channels/defaults",
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
  expect(await screen.findByText(/Slack channel association defaults applied/i)).toBeInTheDocument();
});

it("labels Slack channel association defaults and shows current configured values", async () => {
  render(<SlackChannelRebacPanel />);

  expect(await screen.findByText("Slack Channel Association Default")).toBeInTheDocument();
  expect(screen.queryByText("Migration Defaults")).not.toBeInTheDocument();
  expect(screen.getByText("Current default team")).toBeInTheDocument();
  expect(screen.getByText("team:platform-engineering")).toBeInTheDocument();
  expect(screen.getByText("Current default Dynamic Agent")).toBeInTheDocument();
  expect(screen.getByText("agent:incident-agent")).toBeInTheDocument();
});

it("shows Slack bot runtime sync status and triggers reload/config sync", async () => {
  render(<SlackChannelRebacPanel />);

  expect(await screen.findByText("Slack Bot Runtime Sync")).toBeInTheDocument();
  expect(screen.getByText("db_prefer")).toBeInTheDocument();
  expect(screen.getByText(/1 cached channel/i)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Reload Slack Bot Routes" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/slack/runtime/reload",
      expect.objectContaining({ method: "POST" })
    )
  );

  fireEvent.click(screen.getByRole("button", { name: "Preview Sync From Config" }));
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

  fireEvent.click(screen.getByRole("button", { name: "Apply This Sync" }));
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

  fireEvent.click(await screen.findByRole("button", { name: "Preview Sync From Config" }));

  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  expect(screen.getByText("Slack Bot Config Sync Preview")).toBeInTheDocument();
  expect(screen.getByText("Preview complete")).toBeInTheDocument();
  expect(screen.getByText("1 route planned")).toBeInTheDocument();
  expect(screen.getByText("1 channel scanned")).toBeInTheDocument();
  expect(screen.getByText("0 routes upserted")).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Apply This Sync" }));

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
