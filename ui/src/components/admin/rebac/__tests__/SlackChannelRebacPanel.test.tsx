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

it("applies migration defaults for Slack channels", async () => {
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
  expect(await screen.findByRole("dialog", { name: "Apply migration defaults?" })).toBeInTheDocument();
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
  expect(await screen.findByText(/Migration defaults applied/i)).toBeInTheDocument();
});
