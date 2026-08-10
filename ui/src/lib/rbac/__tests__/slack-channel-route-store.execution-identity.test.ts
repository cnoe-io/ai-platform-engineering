/**
 * @jest-environment node
 *
 * Tests for execution_identity persistence in slack-channel-route-store:
 *
 *  - listSlackChannelAgentRoutes: normalizes missing execution_identity to { mode: "obo_user" }
 *  - replaceSlackChannelAgentRoutes: persists execution_identity when provided
 *  - replaceSlackChannelAgentRoutes: defaults to obo_user when absent
 *
 * assisted-by Claude:claude-sonnet-4-6
 */

// Declare mock fns at module scope so jest.mock factories can reference them
// via closure after jest hoisting. Each mock fn is created with jest.fn() so
// they're callable as soon as the factory runs.

const mockFind = jest.fn();
const mockUpdateMany = jest.fn();
const mockUpdateOne = jest.fn();

jest.mock("@/lib/rbac/mongo-collections", () => ({
  getRbacCollection: jest.fn().mockResolvedValue({
    find: (...args: unknown[]) => mockFind(...args),
    updateMany: (...args: unknown[]) => mockUpdateMany(...args),
    updateOne: (...args: unknown[]) => mockUpdateOne(...args),
  }),
}));

jest.mock("@/lib/rbac/slack-channel-grant-store", () => ({
  slackWorkspaceRef: (ws: string) => ws,
}));

import {
  listSlackChannelAgentRoutes,
  replaceSlackChannelAgentRoutes,
} from "../slack-channel-route-store";
import type { SlackChannelAgentRouteDocument } from "../slack-channel-route-store";

const WS = "T012WS";
const CH = "C01CH";
const NOW = "2026-06-08T00:00:00.000Z";

function makeDoc(overrides: Partial<SlackChannelAgentRouteDocument> = {}): SlackChannelAgentRouteDocument {
  return {
    workspace_id: WS,
    channel_id: CH,
    agent_id: "agent-1",
    enabled: true,
    priority: 100,
    users: { enabled: true, listen: "mention" },
    source_type: "manual",
    status: "active",
    created_by: "actor",
    created_at: NOW,
    updated_by: "actor",
    updated_at: NOW,
    ...overrides,
  };
}

describe("listSlackChannelAgentRoutes — execution_identity normalization", () => {
  afterEach(() => jest.clearAllMocks());

  it("fills in { mode: obo_user } when execution_identity is absent (legacy doc)", async () => {
    const legacyDoc = makeDoc(); // no execution_identity
    mockFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([legacyDoc]),
      }),
    });

    const rows = await listSlackChannelAgentRoutes(WS, CH);
    expect(rows).toHaveLength(1);
    expect(rows[0].execution_identity).toEqual({ mode: "obo_user" });
  });

  it("leaves existing service_account execution_identity intact", async () => {
    const doc = makeDoc({
      execution_identity: {
        mode: "service_account",
        service_account_sub: "sa-sub-123",
        service_account_name: "incident-bot",
      },
    });
    mockFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([doc]),
      }),
    });

    const rows = await listSlackChannelAgentRoutes(WS, CH);
    expect(rows[0].execution_identity).toEqual({
      mode: "service_account",
      service_account_sub: "sa-sub-123",
      service_account_name: "incident-bot",
    });
  });

  it("leaves obo_user execution_identity intact", async () => {
    const doc = makeDoc({ execution_identity: { mode: "obo_user" } });
    mockFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([doc]),
      }),
    });

    const rows = await listSlackChannelAgentRoutes(WS, CH);
    expect(rows[0].execution_identity).toEqual({ mode: "obo_user" });
  });
});

describe("replaceSlackChannelAgentRoutes — execution_identity persistence", () => {
  afterEach(() => jest.clearAllMocks());

  function setupReplaceChain() {
    mockUpdateMany.mockResolvedValue({ modifiedCount: 0 });
    mockUpdateOne.mockResolvedValue({ upsertedCount: 1 });
    // listSlackChannelAgentRoutes call at the end of replace
    mockFind.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
  }

  it("persists execution_identity when provided as service_account", async () => {
    setupReplaceChain();

    await replaceSlackChannelAgentRoutes(
      WS,
      CH,
      [
        {
          workspace_id: WS,
          channel_id: CH,
          agent_id: "agent-sa",
          enabled: true,
          priority: 50,
          execution_identity: {
            mode: "service_account",
            service_account_sub: "sa-sub-abc",
          },
        },
      ],
      "actor"
    );

    const setCall = mockUpdateOne.mock.calls[0];
    const setArg = setCall[1].$set;
    expect(setArg.execution_identity).toEqual({
      mode: "service_account",
      service_account_sub: "sa-sub-abc",
    });
  });

  it("defaults execution_identity to { mode: obo_user } when absent from input", async () => {
    setupReplaceChain();

    await replaceSlackChannelAgentRoutes(
      WS,
      CH,
      [
        {
          workspace_id: WS,
          channel_id: CH,
          agent_id: "agent-1",
          enabled: true,
          priority: 100,
          // no execution_identity
        },
      ],
      "actor"
    );

    const setCall = mockUpdateOne.mock.calls[0];
    const setArg = setCall[1].$set;
    expect(setArg.execution_identity).toEqual({ mode: "obo_user" });
  });

  it("persists obo_user execution_identity explicitly when provided", async () => {
    setupReplaceChain();

    await replaceSlackChannelAgentRoutes(
      WS,
      CH,
      [
        {
          workspace_id: WS,
          channel_id: CH,
          agent_id: "agent-obo",
          enabled: true,
          priority: 100,
          execution_identity: { mode: "obo_user" },
        },
      ],
      "actor"
    );

    const setCall = mockUpdateOne.mock.calls[0];
    const setArg = setCall[1].$set;
    expect(setArg.execution_identity).toEqual({ mode: "obo_user" });
  });

  it("persists service_account with name when provided", async () => {
    setupReplaceChain();

    await replaceSlackChannelAgentRoutes(
      WS,
      CH,
      [
        {
          workspace_id: WS,
          channel_id: CH,
          agent_id: "agent-sa-named",
          enabled: true,
          priority: 10,
          execution_identity: {
            mode: "service_account",
            service_account_sub: "sa-sub-xyz",
            service_account_name: "sre-bot",
          },
        },
      ],
      "actor"
    );

    const setCall = mockUpdateOne.mock.calls[0];
    const setArg = setCall[1].$set;
    expect(setArg.execution_identity).toEqual({
      mode: "service_account",
      service_account_sub: "sa-sub-xyz",
      service_account_name: "sre-bot",
    });
  });
});
