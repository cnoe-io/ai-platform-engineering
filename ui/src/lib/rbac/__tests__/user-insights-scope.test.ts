// Unit tests for the Insights RBAC scope helpers: owned-agent resolution,
// name resolution, and the fail-closed behaviour every helper promises.

const mockListOpenFgaObjects = jest.fn();
const mockCheckOpenFgaTuple = jest.fn();
jest.mock('@/lib/rbac/openfga', () => ({
  listOpenFgaObjects: (...args: unknown[]) => mockListOpenFgaObjects(...args),
  checkOpenFgaTuple: (...args: unknown[]) => mockCheckOpenFgaTuple(...args),
}));

const mockGetCollection = jest.fn();
jest.mock('@/lib/mongodb', () => ({
  getCollection: (...args: unknown[]) => mockGetCollection(...args),
}));

jest.mock('@/lib/rbac/slack-channel-grant-store', () => ({
  slackChannelSubjectId: (ws: string, ch: string) => `${ws}:${ch}`,
}));

import {
  getAgentsByIds,
  getAllAgents,
  getOwnedAgentConversationIds,
  getOwnedAgents,
} from '../user-insights-scope';

/** Minimal collection stub keyed by the method a given helper calls. */
function collectionStub(overrides: Record<string, unknown> = {}) {
  return {
    find: jest.fn().mockReturnValue({
      limit: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      toArray: jest.fn().mockResolvedValue([]),
    }),
    distinct: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
}

beforeEach(() => {
  mockListOpenFgaObjects.mockReset();
  mockCheckOpenFgaTuple.mockReset();
  mockGetCollection.mockReset();
});

describe('getAgentsByIds', () => {
  it('resolves display names from dynamic_agents, falling back to id', async () => {
    mockGetCollection.mockResolvedValue(
      collectionStub({
        find: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([{ _id: 'agent-a', name: 'Alpha' }]),
        }),
      }),
    );

    const result = await getAgentsByIds(['agent-a', 'agent-b']);
    expect(result).toEqual([
      { id: 'agent-a', name: 'Alpha' },
      { id: 'agent-b', name: 'agent-b' }, // no doc → id === name
    ]);
  });

  it('dedupes and trims ids, returns [] for empty input', async () => {
    expect(await getAgentsByIds([])).toEqual([]);
    expect(await getAgentsByIds(['  ', ''])).toEqual([]);
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it('fails open to id === name when the collection throws', async () => {
    mockGetCollection.mockRejectedValue(new Error('mongo down'));
    const result = await getAgentsByIds(['agent-a']);
    expect(result).toEqual([{ id: 'agent-a', name: 'agent-a' }]);
  });
});

describe('getOwnedAgents', () => {
  it('lists can_manage agents, strips the agent: prefix, resolves names', async () => {
    mockListOpenFgaObjects.mockResolvedValue({ objects: ['agent:agent-a', 'agent:agent-b'] });
    mockGetCollection.mockResolvedValue(
      collectionStub({
        find: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([{ _id: 'agent-a', name: 'Alpha' }]),
        }),
      }),
    );

    const result = await getOwnedAgents('user:sub-1');
    expect(mockListOpenFgaObjects).toHaveBeenCalledWith({
      user: 'user:sub-1',
      relation: 'can_manage',
      type: 'agent',
    });
    expect(result).toEqual([
      { id: 'agent-a', name: 'Alpha' },
      { id: 'agent-b', name: 'agent-b' },
    ]);
  });

  it('returns [] when the user owns no agents', async () => {
    mockListOpenFgaObjects.mockResolvedValue({ objects: [] });
    expect(await getOwnedAgents('user:sub-1')).toEqual([]);
  });

  it('fails closed to [] when OpenFGA throws', async () => {
    mockListOpenFgaObjects.mockRejectedValue(new Error('fga down'));
    expect(await getOwnedAgents('user:sub-1')).toEqual([]);
  });
});

describe('getAllAgents', () => {
  it('returns every dynamic agent as {id,name}', async () => {
    mockGetCollection.mockResolvedValue(
      collectionStub({
        find: jest.fn().mockReturnValue({
          limit: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([
              { _id: 'agent-a', name: 'Alpha' },
              { _id: 'agent-b' }, // name falls back to id
            ]),
          }),
        }),
      }),
    );

    expect(await getAllAgents()).toEqual([
      { id: 'agent-a', name: 'Alpha' },
      { id: 'agent-b', name: 'agent-b' },
    ]);
  });

  it('fails closed to [] on error', async () => {
    mockGetCollection.mockRejectedValue(new Error('mongo down'));
    expect(await getAllAgents()).toEqual([]);
  });
});

describe('getOwnedAgentConversationIds', () => {
  it('unions Slack (by id) and web (by name) conversation ids', async () => {
    const convCol = collectionStub({
      find: jest.fn().mockReturnValue({
        limit: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([{ _id: 'conv-slack-1' }, { _id: 'conv-shared' }]),
        }),
      }),
    });
    const msgCol = collectionStub({
      distinct: jest.fn().mockResolvedValue(['conv-web-1', 'conv-shared']),
    });
    mockGetCollection.mockImplementation((name: string) =>
      Promise.resolve(name === 'conversations' ? convCol : msgCol),
    );

    const { ids, capped } = await getOwnedAgentConversationIds([
      { id: 'agent-a', name: 'Alpha' },
    ]);
    expect(capped).toBe(false);
    expect(new Set(ids)).toEqual(new Set(['conv-slack-1', 'conv-shared', 'conv-web-1']));
  });

  it('returns empty for no agents without touching the DB', async () => {
    const result = await getOwnedAgentConversationIds([]);
    expect(result).toEqual({ ids: [], capped: false });
    expect(mockGetCollection).not.toHaveBeenCalled();
  });

  it('fails closed to [] on error', async () => {
    mockGetCollection.mockRejectedValue(new Error('mongo down'));
    expect(await getOwnedAgentConversationIds([{ id: 'a', name: 'A' }])).toEqual({
      ids: [],
      capped: false,
    });
  });
});
