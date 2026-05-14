/**
 * @jest-environment jsdom
 */
/**
 * ChatContainer routing guard for autonomous conversations.
 *
 * Pre-fix the autonomous branch was a no-op, so manually-typed turns
 * saved to MongoDB were never re-loaded on refresh / chat switch. Fix
 * routes autonomous through `loadMessagesFromServer` like Dynamic
 * Agents do; this test pins that behaviour.
 */

import React from 'react';
import { render, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must be before the import of ChatContainer
// ---------------------------------------------------------------------------

const TEST_UUID = '11111111-1111-4111-8111-111111111111';

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { name: 'tester', email: 'tester@example.com' } },
    status: 'authenticated',
  }),
}));

jest.mock('next/navigation', () => ({
  useParams: () => ({ uuid: TEST_UUID }),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

jest.mock('@/lib/config', () => ({
  getConfig: (key: string) => {
    const configs: Record<string, unknown> = {
      caipeUrl: 'http://localhost:8000',
      dynamicAgentsUrl: 'http://localhost:8001',
      dynamicAgentsEnabled: true,
    };
    return configs[key];
  },
}));

jest.mock('@/lib/storage-config', () => ({
  getStorageMode: () => 'mongodb',
  shouldUseLocalStorage: () => false,
}));

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    getConversation: jest.fn(),
    getMessages: jest.fn().mockResolvedValue({ items: [], total: 0 }),
  },
}));

const mockLoadMessagesFromServer = jest.fn().mockResolvedValue(undefined);
const mockLoadTurnsFromServer = jest.fn().mockResolvedValue(undefined);
const mockSetActiveConversation = jest.fn();

const autonomousConv = {
  id: TEST_UUID,
  title: 'My scheduled task',
  source: 'autonomous',
  task_id: 'task-xyz',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  messages: [
    {
      id: 'task:task-xyz:creation_intent',
      role: 'user' as const,
      content: 'created',
      timestamp: new Date(0),
      events: [],
      isFinal: true,
    },
  ],
  a2aEvents: [],
  streamEvents: [],
  participants: [],
};

jest.mock('@/store/chat-store', () => {
  // Minimal stub: hook returning actions + `getState()` for imperative
  // reads of `conversations`.
  const state = {
    conversations: [autonomousConv as unknown],
    setActiveConversation: mockSetActiveConversation,
    loadMessagesFromServer: mockLoadMessagesFromServer,
    loadTurnsFromServer: mockLoadTurnsFromServer,
  };
  const useChatStore = ((selector?: (s: typeof state) => unknown) => {
    if (selector) return selector(state);
    return state;
  }) as unknown as {
    (): typeof state;
    (selector: (s: typeof state) => unknown): unknown;
    getState(): typeof state;
  };
  useChatStore.getState = () => state;
  useChatStore.setState = jest.fn();
  return { useChatStore };
});

// Heavy view children — stub so we don't need to render the entire chat tree.
jest.mock('@/components/chat/PlatformEngineerChatView', () => ({
  SupervisorChatView: () => <div data-testid="supervisor-view" />,
}));
jest.mock('@/components/chat/DynamicAgentChatView', () => ({
  ChatView: () => <div data-testid="dynamic-agent-view" />,
}));
jest.mock('@/components/ui/caipe-spinner', () => ({
  CAIPESpinner: () => <div data-testid="spinner" />,
}));

// Quiet expected console output.
jest.spyOn(console, 'log').mockImplementation(() => {});
jest.spyOn(console, 'warn').mockImplementation(() => {});

import { ChatContainer } from '../ChatContainer';

beforeEach(() => {
  mockLoadMessagesFromServer.mockClear();
  mockLoadTurnsFromServer.mockClear();
  mockSetActiveConversation.mockClear();
});

describe('ChatContainer — autonomous routing', () => {
  it('invokes loadMessagesFromServer for source=autonomous in MongoDB mode', async () => {
    render(<ChatContainer />);

    await waitFor(() => {
      expect(mockLoadMessagesFromServer).toHaveBeenCalledWith(TEST_UUID);
    });

    // Supervisor turns path MUST NOT be used — it has no knowledge of
    // manually-typed turns and would leave them invisible.
    expect(mockLoadTurnsFromServer).not.toHaveBeenCalled();
  });
});
