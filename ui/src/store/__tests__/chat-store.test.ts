/**
 * @jest-environment jsdom
 */
/**
 * Unit tests for chat-store.ts — MongoDB sync features
 *
 * Covers:
 * - loadMessagesFromServer: loads from MongoDB, when NOT streaming replaces local state entirely
 * - loadConversationsFromServer: server conversations replace local; messages start empty (filled by loadMessagesFromServer)
 * - setConversationStreaming: marks unviewed when streaming completes (no longer triggers saves)
 * - createConversation: creates on server in MongoDB mode
 * - deleteConversation: deletes on server in MongoDB mode
 */

// ============================================================================
// Mocks — must be before imports
// ============================================================================

// Use global to avoid TDZ issues with jest.mock factories
(global as any).__mockStorageMode = 'mongodb';

jest.mock('@/lib/api-client', () => ({
  apiClient: {
    addMessage: jest.fn().mockResolvedValue({}),
    getMessages: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    getConversations: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, page_size: 100, has_more: false }),
    createConversation: jest.fn().mockResolvedValue({}),
    deleteConversation: jest.fn().mockResolvedValue({ deleted: true }),
    updateConversation: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('@/lib/storage-config', () => ({
  getStorageMode: () => (global as any).__mockStorageMode,
  shouldUseLocalStorage: () => (global as any).__mockStorageMode === 'localStorage',
}));

jest.mock('@/lib/agui/hooks', () => ({
  streamAGUIEvents: jest.fn().mockReturnValue({
    abortableClient: { abort: jest.fn() },
    streamPromise: Promise.resolve(),
  }),
}));

jest.mock('@/lib/utils', () => ({
  generateId: () => `test-id-${Math.random().toString(36).slice(2, 9)}`,
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

jest.mock('@/lib/timeline-manager', () => ({
  TimelineManager: {
    buildFromEvents: jest.fn().mockReturnValue([]),
  },
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import { useChatStore } from '../chat-store';
import { apiClient } from '@/lib/api-client';
import type { Conversation, ChatMessage, A2AEvent } from '@/types/a2a';

// Get typed mock references
const mockApiClient = apiClient as jest.Mocked<typeof apiClient>;

// ============================================================================
// Helpers
// ============================================================================

function makeConversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: `conv-${Math.random().toString(36).slice(2, 9)}`,
    title: 'Test Conversation',
    createdAt: new Date(),
    updatedAt: new Date(),
    messages: [],
    a2aEvents: [],
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 9)}`,
    role: 'user',
    content: 'Hello',
    timestamp: new Date(),
    events: [],
    ...overrides,
  };
}

function makeA2AEvent(overrides: Partial<A2AEvent> = {}): A2AEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 9)}`,
    timestamp: new Date(),
    type: 'tool_start',
    raw: {} as any,
    displayName: 'Test Event',
    displayContent: 'Testing...',
    color: 'blue',
    icon: 'wrench',
    ...overrides,
  };
}

function resetStore() {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isStreaming: false,
    streamingConversations: new Map(),
    a2aEvents: [],
    pendingMessage: null,
    selectedTurnIds: new Map(),
    unviewedConversations: new Set(),
    inputRequiredConversations: new Set(),
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('chat-store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (global as any).__mockStorageMode = 'mongodb';
    resetStore();
  });

  afterEach(() => {
    jest.useRealTimers();
  });


  // --------------------------------------------------------------------------
  // loadMessagesFromServer
  // --------------------------------------------------------------------------

  describe('loadMessagesFromServer', () => {
    it('loads messages from MongoDB and updates store', async () => {
      const conv = makeConversation({ id: 'load-test-1' });
      useChatStore.setState({ conversations: [conv] });

      const serverMessages = [
        {
          _id: 'mongo-1',
          message_id: 'msg-1',
          conversation_id: 'load-test-1',
          role: 'user',
          content: 'List apps',
          created_at: '2025-01-01T00:00:00Z',
          metadata: { turn_id: 'turn-1' },
        },
        {
          _id: 'mongo-2',
          message_id: 'msg-2',
          conversation_id: 'load-test-1',
          role: 'assistant',
          content: 'Here are 5 apps...',
          created_at: '2025-01-01T00:00:01Z',
          metadata: { turn_id: 'turn-1', is_final: true },
          a2a_events: [
            { id: 'evt-1', type: 'tool_start', timestamp: '2025-01-01T00:00:00.500Z', displayName: 'ArgoCD', displayContent: 'Listing...', color: 'blue', icon: 'list' },
          ],
        },
      ];

      mockApiClient.getMessages.mockResolvedValue({
        items: serverMessages,
        total: 2,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadMessagesFromServer('load-test-1');

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'load-test-1');
      expect(updatedConv).toBeDefined();
      expect(updatedConv!.messages).toHaveLength(2);

      // Verify user message
      expect(updatedConv!.messages[0].id).toBe('msg-1');
      expect(updatedConv!.messages[0].role).toBe('user');
      expect(updatedConv!.messages[0].content).toBe('List apps');

      // Verify assistant message
      expect(updatedConv!.messages[1].id).toBe('msg-2');
      expect(updatedConv!.messages[1].content).toBe('Here are 5 apps...');
      expect(updatedConv!.messages[1].isFinal).toBe(true);

      // Verify A2A events were deserialized
      expect(updatedConv!.messages[1].events).toHaveLength(1);
      expect(updatedConv!.messages[1].events[0].type).toBe('tool_start');
      expect(updatedConv!.messages[1].events[0].timestamp).toBeInstanceOf(Date);

      // Verify conversation-level a2aEvents reconstructed for ContextPanel
      expect(updatedConv!.a2aEvents).toHaveLength(1);
    });

    it('still loads from server even when local messages have events (for cross-device sync)', async () => {
      const event = makeA2AEvent({ id: 'local-evt', type: 'tool_start' });
      const conv = makeConversation({ id: 'has-local' });
      conv.messages = [makeMessage({ id: 'existing-msg', content: 'Already here', events: [event] })];
      conv.a2aEvents = [event];
      useChatStore.setState({ conversations: [conv] });

      // Server may have new messages from another device
      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-1', message_id: 'existing-msg', conversation_id: 'has-local',
            role: 'user', content: 'Already here', created_at: '2026-01-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' }, a2a_events: [],
          },
        ],
        total: 1,
      });

      await useChatStore.getState().loadMessagesFromServer('has-local');

      // Should still call API for cross-device sync
      expect(mockApiClient.getMessages).toHaveBeenCalled();
    });

    it('loads events from MongoDB when local messages exist but have no events (localStorage cache scenario)', async () => {
      // This simulates what happens after a page refresh or on a different device:
      // localStorage cache has message stubs (content, role, etc.) but events: []
      // because partialize strips them. We need to reload from MongoDB to restore
      // Tasks and A2A Debug data.
      const conv = makeConversation({ id: 'stubs-no-events' });
      conv.messages = [
        makeMessage({ id: 'user-msg', role: 'user', content: 'List my apps', events: [] }),
        makeMessage({ id: 'asst-msg', role: 'assistant', content: 'Here are 5 apps...', events: [] }),
      ];
      conv.a2aEvents = []; // No events (stripped by partialize)
      useChatStore.setState({ conversations: [conv] });

      const serverMessages = [
        {
          _id: 'mongo-user',
          message_id: 'user-msg',
          conversation_id: 'stubs-no-events',
          role: 'user',
          content: 'List my apps',
          created_at: '2026-01-01T00:00:00Z',
          metadata: { turn_id: 'turn-1' },
          a2a_events: [],
        },
        {
          _id: 'mongo-asst',
          message_id: 'asst-msg',
          conversation_id: 'stubs-no-events',
          role: 'assistant',
          content: 'Here are 5 apps...',
          created_at: '2026-01-01T00:00:01Z',
          metadata: { turn_id: 'turn-1', is_final: true },
          a2a_events: [
            {
              id: 'evt-tool-1',
              type: 'tool_start',
              timestamp: '2026-01-01T00:00:00.500Z',
              taskId: 'task-1',
              sourceAgent: 'argocd-agent',
              displayName: 'ArgoCD List',
              displayContent: 'Listing applications...',
              color: 'blue',
              icon: 'list',
              artifact: {
                name: 'tool_notification_start',
                parts: [{ kind: 'text', text: 'Listing apps' }],
              },
            },
            {
              id: 'evt-plan-1',
              type: 'execution_plan',
              timestamp: '2026-01-01T00:00:00.200Z',
              displayName: 'Execution Plan',
              displayContent: '⏳ [ArgoCD] List all applications',
              color: 'green',
              icon: 'plan',
              artifact: {
                name: 'execution_plan_update',
                parts: [{ kind: 'text', text: '⏳ [ArgoCD] List all applications' }],
              },
            },
          ],
        },
      ];

      mockApiClient.getMessages.mockResolvedValue({
        items: serverMessages,
        total: 2,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadMessagesFromServer('stubs-no-events');

      // API should have been called (local messages exist but have no events)
      expect(mockApiClient.getMessages).toHaveBeenCalledWith('stubs-no-events', { page_size: 100 });

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'stubs-no-events');
      expect(updatedConv).toBeDefined();

      // Local messages should still be there (merged, not replaced)
      expect(updatedConv!.messages).toHaveLength(2);
      expect(updatedConv!.messages[0].content).toBe('List my apps');
      expect(updatedConv!.messages[1].content).toBe('Here are 5 apps...');

      // Events should now be populated from MongoDB
      expect(updatedConv!.messages[1].events).toHaveLength(2);
      expect(updatedConv!.messages[1].events[0].type).toBe('tool_start');
      expect(updatedConv!.messages[1].events[0].sourceAgent).toBe('argocd-agent');
      expect(updatedConv!.messages[1].events[1].type).toBe('execution_plan');

      // Conversation-level a2aEvents should be reconstructed for ContextPanel (Tasks + Debug)
      expect(updatedConv!.a2aEvents).toHaveLength(2);
      expect(updatedConv!.a2aEvents.some(e => e.artifact?.name === 'execution_plan_update')).toBe(true);
      expect(updatedConv!.a2aEvents.some(e => e.artifact?.name === 'tool_notification_start')).toBe(true);
    });

    it('replaces local state entirely when loading from MongoDB (no merge, feedback lost)', async () => {
      // When NOT streaming, MongoDB data REPLACES local state entirely.
      // Local-only state like feedback is not preserved.
      const conv = makeConversation({ id: 'replace-feedback' });
      conv.messages = [
        makeMessage({
          id: 'msg-with-feedback',
          role: 'assistant',
          content: 'Great answer',
          events: [],
          feedback: { type: 'like', submitted: true }, // Local feedback — will be lost
        }),
      ];
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-fb',
            message_id: 'msg-with-feedback',
            conversation_id: 'replace-feedback',
            role: 'assistant',
            content: 'Great answer',
            created_at: '2026-01-01T00:00:00Z',
            metadata: { turn_id: 'turn-1', is_final: true },
            a2a_events: [
              { id: 'evt-1', type: 'tool_end', timestamp: '2026-01-01T00:00:00Z', displayName: 'Done', displayContent: 'Complete', color: 'green', icon: 'check' },
            ],
          },
        ],
        total: 1,
      });

      await useChatStore.getState().loadMessagesFromServer('replace-feedback');

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'replace-feedback');

      // MongoDB messages replace local state
      expect(updatedConv!.messages).toHaveLength(1);
      expect(updatedConv!.messages[0].events).toHaveLength(1);
      expect(updatedConv!.messages[0].events[0].type).toBe('tool_end');

      // Local feedback is NOT preserved — server data replaces local entirely
      // (Server response has no feedback field, so it's undefined)
      expect(updatedConv!.messages[0].feedback).toBeUndefined();
    });

    it('still loads from server when conversation has local events on conversation level (for cross-device sync)', async () => {
      const event = makeA2AEvent({ id: 'conv-level-evt' });
      const conv = makeConversation({ id: 'has-conv-events' });
      conv.messages = [makeMessage({ id: 'msg-1', content: 'Has content', events: [] })]; // No per-message events
      conv.a2aEvents = [event]; // But has conversation-level events
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-1', message_id: 'msg-1', conversation_id: 'has-conv-events',
            role: 'user', content: 'Has content', created_at: '2026-01-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' }, a2a_events: [],
          },
        ],
        total: 1,
      });

      await useChatStore.getState().loadMessagesFromServer('has-conv-events');

      // Should call API for cross-device sync
      expect(mockApiClient.getMessages).toHaveBeenCalled();
    });

    it('skips immediate re-calls within cooldown but force bypasses it', async () => {
      const conv = makeConversation({ id: 'reload-test' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({ items: [], total: 0 });

      // First call
      await useChatStore.getState().loadMessagesFromServer('reload-test');
      expect(mockApiClient.getMessages).toHaveBeenCalledTimes(1);

      // Immediate second call — skipped due to cooldown
      mockApiClient.getMessages.mockClear();
      await useChatStore.getState().loadMessagesFromServer('reload-test');
      expect(mockApiClient.getMessages).not.toHaveBeenCalled();

      // Force bypass — should call API
      mockApiClient.getMessages.mockClear();
      mockApiClient.getMessages.mockResolvedValue({ items: [], total: 0 });
      await useChatStore.getState().loadMessagesFromServer('reload-test', { force: true });
      expect(mockApiClient.getMessages).toHaveBeenCalledTimes(1);
    });

    it('skips loading in localStorage mode', async () => {
      (global as any).__mockStorageMode = 'localStorage';

      const conv = makeConversation({ id: 'ls-load' });
      useChatStore.setState({ conversations: [conv] });

      await useChatStore.getState().loadMessagesFromServer('ls-load');
      expect(mockApiClient.getMessages).not.toHaveBeenCalled();
    });

    it('handles empty response gracefully', async () => {
      const conv = makeConversation({ id: 'empty-load' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({ items: [], total: 0 });

      await useChatStore.getState().loadMessagesFromServer('empty-load');

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'empty-load');
      expect(updatedConv!.messages).toHaveLength(0);
    });

    it('handles 401 error gracefully without throwing', async () => {
      const conv = makeConversation({ id: 'auth-error-load' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockRejectedValue(new Error('Unauthorized'));

      // Should not throw
      await expect(
        useChatStore.getState().loadMessagesFromServer('auth-error-load')
      ).resolves.toBeUndefined();
    });

    it('handles 404 error gracefully without throwing', async () => {
      const conv = makeConversation({ id: 'notfound-load' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockRejectedValue(new Error('not found'));

      await expect(
        useChatStore.getState().loadMessagesFromServer('notfound-load')
      ).resolves.toBeUndefined();
    });

    it('uses message_id when available, falls back to _id', async () => {
      const conv = makeConversation({ id: 'id-fallback' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-id-only',
            conversation_id: 'id-fallback',
            role: 'user',
            content: 'No message_id',
            created_at: '2025-01-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' },
            // No message_id field
          },
        ],
        total: 1,
      });

      await useChatStore.getState().loadMessagesFromServer('id-fallback');

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'id-fallback');
      expect(updatedConv!.messages[0].id).toBe('mongo-id-only');
    });

    it('converts feedback rating correctly', async () => {
      const conv = makeConversation({ id: 'feedback-test' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'fb-msg',
            message_id: 'fb-1',
            conversation_id: 'feedback-test',
            role: 'assistant',
            content: 'Good answer',
            created_at: '2025-01-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' },
            feedback: { rating: 'positive', comment: 'Great!', submitted_at: new Date() },
          },
        ],
        total: 1,
      });

      await useChatStore.getState().loadMessagesFromServer('feedback-test');

      const msg = useChatStore.getState().conversations.find(c => c.id === 'feedback-test')!.messages[0];
      expect(msg.feedback).toEqual({ type: 'like', submitted: true });
    });

    it('appends follow-up messages from server that do not exist locally (cross-device sync)', async () => {
      // Simulate: Device A has 2 messages (turn 1). User sends follow-up on Device B,
      // which creates 2 more messages (turn 2) in MongoDB. When Device A loads from
      // server, it should merge the new messages into its local state.
      const conv = makeConversation({ id: 'follow-up-sync' });
      conv.messages = [
        makeMessage({ id: 'msg-turn1-user', role: 'user', content: 'List my apps', events: [] }),
        makeMessage({ id: 'msg-turn1-asst', role: 'assistant', content: 'Here are 5 apps...', events: [] }),
      ];
      useChatStore.setState({ conversations: [conv] });

      // Server has 4 messages: 2 from turn 1 + 2 from turn 2 (sent from another device)
      const serverMessages = [
        {
          _id: 'mongo-1', message_id: 'msg-turn1-user', conversation_id: 'follow-up-sync',
          role: 'user', content: 'List my apps', created_at: '2026-02-01T00:00:00Z',
          metadata: { turn_id: 'turn-1' }, a2a_events: [],
        },
        {
          _id: 'mongo-2', message_id: 'msg-turn1-asst', conversation_id: 'follow-up-sync',
          role: 'assistant', content: 'Here are 5 apps...', created_at: '2026-02-01T00:00:01Z',
          metadata: { turn_id: 'turn-1', is_final: true },
          a2a_events: [
            { id: 'evt-turn1', type: 'tool_start', timestamp: '2026-02-01T00:00:00.500Z',
              displayName: 'ArgoCD', displayContent: 'Listing...', color: 'blue', icon: 'list' },
          ],
        },
        {
          _id: 'mongo-3', message_id: 'msg-turn2-user', conversation_id: 'follow-up-sync',
          role: 'user', content: 'Show details for app-1', created_at: '2026-02-01T00:01:00Z',
          metadata: { turn_id: 'turn-2' }, a2a_events: [],
        },
        {
          _id: 'mongo-4', message_id: 'msg-turn2-asst', conversation_id: 'follow-up-sync',
          role: 'assistant', content: 'App-1 is healthy and synced.', created_at: '2026-02-01T00:01:01Z',
          metadata: { turn_id: 'turn-2', is_final: true },
          a2a_events: [
            { id: 'evt-turn2', type: 'tool_start', timestamp: '2026-02-01T00:01:00.500Z',
              displayName: 'ArgoCD Detail', displayContent: 'Fetching app-1...', color: 'blue', icon: 'detail' },
          ],
        },
      ];

      mockApiClient.getMessages.mockResolvedValue({
        items: serverMessages, total: 4, page: 1, page_size: 100, has_more: false,
      });

      await useChatStore.getState().loadMessagesFromServer('follow-up-sync');

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'follow-up-sync');
      expect(updatedConv).toBeDefined();

      // Should now have all 4 messages (2 local + 2 new from server)
      expect(updatedConv!.messages).toHaveLength(4);
      expect(updatedConv!.messages[0].id).toBe('msg-turn1-user');
      expect(updatedConv!.messages[1].id).toBe('msg-turn1-asst');
      expect(updatedConv!.messages[2].id).toBe('msg-turn2-user');
      expect(updatedConv!.messages[2].content).toBe('Show details for app-1');
      expect(updatedConv!.messages[3].id).toBe('msg-turn2-asst');
      expect(updatedConv!.messages[3].content).toBe('App-1 is healthy and synced.');
    });

    it('only sets a2aEvents from the LAST assistant message (not all turns)', async () => {
      // When loading from MongoDB, a2aEvents should only contain events from the
      // last assistant message (latest turn), matching the live-streaming behavior
      // where clearA2AEvents() is called at the start of each new turn.
      const conv = makeConversation({ id: 'last-turn-events' });
      useChatStore.setState({ conversations: [conv] });

      const serverMessages = [
        {
          _id: 'mongo-1', message_id: 'msg-t1-user', conversation_id: 'last-turn-events',
          role: 'user', content: 'List apps', created_at: '2026-02-01T00:00:00Z',
          metadata: { turn_id: 'turn-1' }, a2a_events: [],
        },
        {
          _id: 'mongo-2', message_id: 'msg-t1-asst', conversation_id: 'last-turn-events',
          role: 'assistant', content: 'Here are apps...', created_at: '2026-02-01T00:00:01Z',
          metadata: { turn_id: 'turn-1', is_final: true },
          a2a_events: [
            { id: 'evt-old-1', type: 'tool_start', timestamp: '2026-02-01T00:00:00.500Z',
              displayName: 'Old Tool 1', displayContent: 'Turn 1 tool', color: 'blue', icon: 'list' },
            { id: 'evt-old-2', type: 'tool_end', timestamp: '2026-02-01T00:00:00.700Z',
              displayName: 'Old Tool 1 Done', displayContent: 'Turn 1 done', color: 'green', icon: 'check' },
          ],
        },
        {
          _id: 'mongo-3', message_id: 'msg-t2-user', conversation_id: 'last-turn-events',
          role: 'user', content: 'Show app-1 details', created_at: '2026-02-01T00:01:00Z',
          metadata: { turn_id: 'turn-2' }, a2a_events: [],
        },
        {
          _id: 'mongo-4', message_id: 'msg-t2-asst', conversation_id: 'last-turn-events',
          role: 'assistant', content: 'App-1 details...', created_at: '2026-02-01T00:01:01Z',
          metadata: { turn_id: 'turn-2', is_final: true },
          a2a_events: [
            { id: 'evt-new-1', type: 'tool_start', timestamp: '2026-02-01T00:01:00.500Z',
              displayName: 'New Tool', displayContent: 'Turn 2 tool', color: 'blue', icon: 'detail' },
          ],
        },
      ];

      mockApiClient.getMessages.mockResolvedValue({
        items: serverMessages, total: 4, page: 1, page_size: 100, has_more: false,
      });

      await useChatStore.getState().loadMessagesFromServer('last-turn-events');

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'last-turn-events');
      expect(updatedConv).toBeDefined();

      // Per-message events should be fully preserved
      expect(updatedConv!.messages[1].events).toHaveLength(2); // Turn 1 assistant: 2 events
      expect(updatedConv!.messages[3].events).toHaveLength(1); // Turn 2 assistant: 1 event

      // Conversation-level a2aEvents should ONLY contain events from the LAST assistant message
      // (turn 2), NOT accumulated from all turns
      expect(updatedConv!.a2aEvents).toHaveLength(1);
      expect(updatedConv!.a2aEvents[0].id).toBe('evt-new-1');
      expect(updatedConv!.a2aEvents[0].displayName).toBe('New Tool');
    });

    it('sets empty a2aEvents when last assistant message has no events', async () => {
      const conv = makeConversation({ id: 'no-events-last' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-1', message_id: 'msg-user', conversation_id: 'no-events-last',
            role: 'user', content: 'Hello', created_at: '2026-02-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' }, a2a_events: [],
          },
          {
            _id: 'mongo-2', message_id: 'msg-asst', conversation_id: 'no-events-last',
            role: 'assistant', content: 'Hi there!', created_at: '2026-02-01T00:00:01Z',
            metadata: { turn_id: 'turn-1', is_final: true },
            a2a_events: [], // No events
          },
        ],
        total: 2,
      });

      await useChatStore.getState().loadMessagesFromServer('no-events-last');

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'no-events-last');
      expect(updatedConv!.a2aEvents).toHaveLength(0);
    });

    it('handles conversation with only user messages (no assistant) gracefully', async () => {
      const conv = makeConversation({ id: 'user-only' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-1', message_id: 'msg-user', conversation_id: 'user-only',
            role: 'user', content: 'Hello', created_at: '2026-02-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' }, a2a_events: [],
          },
        ],
        total: 1,
      });

      await useChatStore.getState().loadMessagesFromServer('user-only');

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'user-only');
      expect(updatedConv!.messages).toHaveLength(1);
      expect(updatedConv!.a2aEvents).toHaveLength(0);
    });

    it('prevents concurrent loads for the same conversation', async () => {
      const conv = makeConversation({ id: 'concurrent-test' });
      useChatStore.setState({ conversations: [conv] });

      // Use a deferred promise so we can control when the API call resolves
      let resolveApi!: (value: any) => void;
      const apiPromise = new Promise(resolve => { resolveApi = resolve; });
      mockApiClient.getMessages.mockReturnValue(apiPromise);

      // Fire two loads simultaneously (second should be skipped while first is in-flight)
      const promise1 = useChatStore.getState().loadMessagesFromServer('concurrent-test');
      const promise2 = useChatStore.getState().loadMessagesFromServer('concurrent-test');

      // Resolve the API call
      resolveApi({ items: [], total: 0 });

      await Promise.all([promise1, promise2]);

      // Only one API call should have been made (second was skipped)
      expect(mockApiClient.getMessages).toHaveBeenCalledTimes(1);
    });

    it('skips reload within cooldown window but allows force reload', async () => {
      const conv = makeConversation({ id: 'cooldown-test' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({ items: [], total: 0 });

      // First call — succeeds
      await useChatStore.getState().loadMessagesFromServer('cooldown-test');
      expect(mockApiClient.getMessages).toHaveBeenCalledTimes(1);

      // Second call immediately — should be skipped (within cooldown)
      mockApiClient.getMessages.mockClear();
      await useChatStore.getState().loadMessagesFromServer('cooldown-test');
      expect(mockApiClient.getMessages).not.toHaveBeenCalled();

      // Force call — should bypass cooldown
      mockApiClient.getMessages.mockClear();
      mockApiClient.getMessages.mockResolvedValue({ items: [], total: 0 });
      await useChatStore.getState().loadMessagesFromServer('cooldown-test', { force: true });
      expect(mockApiClient.getMessages).toHaveBeenCalledTimes(1);
    });

    it('replaces local messages entirely with MongoDB data (feedback not preserved)', async () => {
      // When NOT streaming, MongoDB data REPLACES local state entirely.
      // Local feedback on existing messages is lost — server is source of truth.
      const conv = makeConversation({ id: 'feedback-replace-sync' });
      conv.messages = [
        makeMessage({ id: 'msg-user-1', role: 'user', content: 'List apps', events: [] }),
        makeMessage({
          id: 'msg-asst-1', role: 'assistant', content: 'Here are apps...',
          events: [], feedback: { type: 'like', submitted: true }, // Local feedback — will be lost
        }),
      ];
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-1', message_id: 'msg-user-1', conversation_id: 'feedback-replace-sync',
            role: 'user', content: 'List apps', created_at: '2026-02-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' }, a2a_events: [],
          },
          {
            _id: 'mongo-2', message_id: 'msg-asst-1', conversation_id: 'feedback-replace-sync',
            role: 'assistant', content: 'Here are apps...', created_at: '2026-02-01T00:00:01Z',
            metadata: { turn_id: 'turn-1', is_final: true },
            a2a_events: [
              { id: 'evt-1', type: 'tool_start', timestamp: '2026-02-01T00:00:00.500Z',
                displayName: 'Tool', displayContent: 'Running...', color: 'blue', icon: 'list' },
            ],
          },
          {
            _id: 'mongo-3', message_id: 'msg-user-2', conversation_id: 'feedback-replace-sync',
            role: 'user', content: 'Follow up', created_at: '2026-02-01T00:01:00Z',
            metadata: { turn_id: 'turn-2' }, a2a_events: [],
          },
          {
            _id: 'mongo-4', message_id: 'msg-asst-2', conversation_id: 'feedback-replace-sync',
            role: 'assistant', content: 'Follow up response', created_at: '2026-02-01T00:01:01Z',
            metadata: { turn_id: 'turn-2', is_final: true },
            a2a_events: [],
          },
        ],
        total: 4,
      });

      await useChatStore.getState().loadMessagesFromServer('feedback-replace-sync');

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'feedback-replace-sync');
      expect(updatedConv!.messages).toHaveLength(4);

      // Messages are replaced entirely — local feedback is NOT preserved
      // (Server response has no feedback on msg-asst-1, so it's undefined)
      expect(updatedConv!.messages[1].feedback).toBeUndefined();

      // All 4 messages come from server (replacement, not merge)
      expect(updatedConv!.messages[2].content).toBe('Follow up');
      expect(updatedConv!.messages[3].content).toBe('Follow up response');
    });

    it('force=true resets cooldown and allows immediate reload', async () => {
      const conv = makeConversation({ id: 'force-reload' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({ items: [], total: 0 });

      // First call — succeeds, sets cooldown
      await useChatStore.getState().loadMessagesFromServer('force-reload');
      expect(mockApiClient.getMessages).toHaveBeenCalledTimes(1);

      // Immediate second call without force — skipped (within cooldown)
      mockApiClient.getMessages.mockClear();
      await useChatStore.getState().loadMessagesFromServer('force-reload');
      expect(mockApiClient.getMessages).not.toHaveBeenCalled();

      // Force call — bypasses cooldown
      mockApiClient.getMessages.mockClear();
      mockApiClient.getMessages.mockResolvedValue({ items: [], total: 0 });
      await useChatStore.getState().loadMessagesFromServer('force-reload', { force: true });
      expect(mockApiClient.getMessages).toHaveBeenCalledTimes(1);

      // After force, cooldown resets — another normal call within cooldown is skipped
      mockApiClient.getMessages.mockClear();
      await useChatStore.getState().loadMessagesFromServer('force-reload');
      expect(mockApiClient.getMessages).not.toHaveBeenCalled();
    });

    it('does not duplicate messages when server returns same messages as local', async () => {
      // If local and server have the exact same messages, no duplicates should appear
      const conv = makeConversation({ id: 'no-dup-sync' });
      conv.messages = [
        makeMessage({ id: 'msg-1', role: 'user', content: 'Hello', events: [] }),
        makeMessage({ id: 'msg-2', role: 'assistant', content: 'Hi there', events: [] }),
      ];
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-1', message_id: 'msg-1', conversation_id: 'no-dup-sync',
            role: 'user', content: 'Hello', created_at: '2026-02-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' }, a2a_events: [],
          },
          {
            _id: 'mongo-2', message_id: 'msg-2', conversation_id: 'no-dup-sync',
            role: 'assistant', content: 'Hi there', created_at: '2026-02-01T00:00:01Z',
            metadata: { turn_id: 'turn-1', is_final: true }, a2a_events: [],
          },
        ],
        total: 2,
      });

      await useChatStore.getState().loadMessagesFromServer('no-dup-sync');

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'no-dup-sync');
      // Should still have exactly 2 messages — no duplicates
      expect(updatedConv!.messages).toHaveLength(2);
      expect(updatedConv!.messages[0].id).toBe('msg-1');
      expect(updatedConv!.messages[1].id).toBe('msg-2');
    });

    it('handles server returning empty items while local has messages (no data loss)', async () => {
      const conv = makeConversation({ id: 'empty-server' });
      conv.messages = [
        makeMessage({ id: 'local-msg', role: 'user', content: 'Existing message' }),
      ];
      useChatStore.setState({ conversations: [conv] });

      // Server returns no items (e.g., messages deleted on server)
      mockApiClient.getMessages.mockResolvedValue({ items: [], total: 0 });

      await useChatStore.getState().loadMessagesFromServer('empty-server');

      // Local messages should be preserved (empty response doesn't clear local state)
      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'empty-server');
      expect(updatedConv!.messages).toHaveLength(1);
      expect(updatedConv!.messages[0].content).toBe('Existing message');
    });

    it('handles loadMessagesFromServer for conversation not in local store', async () => {
      // If the conversation doesn't exist locally, the function should still work
      // (hasLocalMessages will be false, conv will be undefined)
      useChatStore.setState({ conversations: [] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-1', message_id: 'msg-1', conversation_id: 'nonexistent',
            role: 'user', content: 'Hello', created_at: '2026-02-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' }, a2a_events: [],
          },
        ],
        total: 1,
      });

      // Should not throw — just won't find the conversation to update
      await expect(
        useChatStore.getState().loadMessagesFromServer('nonexistent')
      ).resolves.toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // loadConversationsFromServer — deletion sync
  // --------------------------------------------------------------------------

  describe('loadConversationsFromServer — deletion sync', () => {
    it('removes conversations that exist locally but not on server', async () => {
      // Local state has 3 conversations
      const conv1 = makeConversation({ id: 'keep-1', title: 'Keep Me' });
      const conv2 = makeConversation({ id: 'delete-me', title: 'Deleted on Other Browser' });
      const conv3 = makeConversation({ id: 'keep-2', title: 'Keep Me Too' });

      useChatStore.setState({
        conversations: [conv1, conv2, conv3],
        activeConversationId: 'keep-1',
      });

      // Server only returns 2 of them (conv2 was deleted on another device)
      mockApiClient.getConversations.mockResolvedValue({
        items: [
          { _id: 'keep-1', title: 'Keep Me', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          { _id: 'keep-2', title: 'Keep Me Too', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ],
        total: 2,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      const convIds = useChatStore.getState().conversations.map(c => c.id);
      expect(convIds).toContain('keep-1');
      expect(convIds).toContain('keep-2');
      expect(convIds).not.toContain('delete-me');
    });

    it('preserves local-only conversations that are actively streaming', async () => {
      const streamingConv = makeConversation({ id: 'streaming-new', title: 'Just Created' });

      // Simulate that this conversation is currently streaming
      const streamingMap = new Map();
      streamingMap.set('streaming-new', { conversationId: 'streaming-new', messageId: 'msg-1', client: {} });

      useChatStore.setState({
        conversations: [streamingConv],
        streamingConversations: streamingMap,
      });

      // Server has no conversations (it was just created, server hasn't caught up)
      mockApiClient.getConversations.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      const convIds = useChatStore.getState().conversations.map(c => c.id);
      expect(convIds).toContain('streaming-new');
    });

    it('preserves active conversation even when absent from server response (audit/shared scenario)', async () => {
      // When the active conversation belongs to another user (audit/shared),
      // the server response won't include it. It must be preserved as a
      // local-only entry so the user doesn't lose their view.
      const conv1 = makeConversation({ id: 'still-here', title: 'Still Here' });
      const auditConv = makeConversation({ id: 'audit-conv', title: 'Audit Conversation', messages: [makeMessage()] });

      useChatStore.setState({
        conversations: [conv1, auditConv],
        activeConversationId: 'audit-conv', // User is viewing this audit conversation
      });

      // Server only returns conv1 (audit-conv belongs to another user)
      mockApiClient.getConversations.mockResolvedValue({
        items: [
          { _id: 'still-here', title: 'Still Here', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ],
        total: 1,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      // Active conversation should be preserved as local-only entry
      const convIds = useChatStore.getState().conversations.map(c => c.id);
      expect(convIds).toContain('audit-conv');
      expect(convIds).toContain('still-here');
      expect(useChatStore.getState().activeConversationId).toBe('audit-conv');
    });

    it('preserves active conversation with zero messages (race condition)', async () => {
      // When a user navigates to an audit conversation via URL,
      // loadMessagesFromServer runs async. If loadConversationsFromServer
      // fires before messages arrive, the conversation has 0 messages.
      // It must still be preserved to prevent the infinite spinner.
      const loadingConv = makeConversation({ id: 'loading-conv', title: 'Loading...', messages: [] });

      useChatStore.setState({
        conversations: [loadingConv],
        activeConversationId: 'loading-conv',
      });

      // Server returns empty (audit conversation belongs to another user)
      mockApiClient.getConversations.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      // Conversation must be preserved even with 0 messages
      const convIds = useChatStore.getState().conversations.map(c => c.id);
      expect(convIds).toContain('loading-conv');
      expect(useChatStore.getState().activeConversationId).toBe('loading-conv');
    });

    it('no duplicate when active conversation is also in server response', async () => {
      // If the active conversation IS in the server response (user's own conversation),
      // the local-only preservation should NOT create a duplicate.
      const conv = makeConversation({ id: 'both-conv', title: 'My Conversation', messages: [makeMessage()] });

      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'both-conv',
      });

      mockApiClient.getConversations.mockResolvedValue({
        items: [
          { _id: 'both-conv', title: 'My Conversation', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ],
        total: 1,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      // Should have exactly 1 entry, not duplicated
      const matching = useChatStore.getState().conversations.filter(c => c.id === 'both-conv');
      expect(matching).toHaveLength(1);
    });

    it('preserves in-memory messages for conversations that already have them loaded', async () => {
      // When loadConversationsFromServer refreshes the list, conversations that already
      // have messages loaded in memory should keep them to avoid wiping content on tab switch.
      // Messages are only empty for conversations that have NOT been opened yet.
      const localMsg = makeMessage({ id: 'local-msg', content: 'I have content' });
      const conv = makeConversation({ id: 'has-msgs', title: 'Has Messages', messages: [localMsg] });

      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getConversations.mockResolvedValue({
        items: [
          { _id: 'has-msgs', title: 'Has Messages', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ],
        total: 1,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'has-msgs');
      // Messages should be preserved — not wiped to empty
      expect(updatedConv!.messages).toHaveLength(1);
      expect(updatedConv!.messages[0].content).toBe('I have content');
    });

    it('new server conversations without local messages start with empty messages', async () => {
      // Conversations that have NOT been opened locally should start with empty messages.
      // loadMessagesFromServer fills them when the user opens the conversation.
      useChatStore.setState({ conversations: [] });

      mockApiClient.getConversations.mockResolvedValue({
        items: [
          { _id: 'new-conv', title: 'New Conversation', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ],
        total: 1,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      const newConv = useChatStore.getState().conversations.find(c => c.id === 'new-conv');
      expect(newConv!.messages).toHaveLength(0);
    });

    it('does not preserve non-active non-streaming local-only conversations', async () => {
      // Conversations that are neither active nor streaming should be removed
      // when not present in the server response (FR-004).
      const staleConv = makeConversation({ id: 'stale-conv', title: 'Stale' });

      useChatStore.setState({
        conversations: [staleConv],
        activeConversationId: 'some-other-id', // Different from stale-conv
      });

      mockApiClient.getConversations.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      const convIds = useChatStore.getState().conversations.map(c => c.id);
      expect(convIds).not.toContain('stale-conv');
    });

    it('skips loading in localStorage mode', async () => {
      (global as any).__mockStorageMode = 'localStorage';

      useChatStore.setState({
        conversations: [makeConversation()],
      });

      await useChatStore.getState().loadConversationsFromServer();

      // Should not call API
      expect(mockApiClient.getConversations).not.toHaveBeenCalled();
    });

    it('preserves conversations on API error (does not clear)', async () => {
      const conv = makeConversation({ id: 'error-safe', title: 'Safe' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getConversations.mockRejectedValue(new Error('Server down'));

      await useChatStore.getState().loadConversationsFromServer();

      // Conversations should still be there
      expect(useChatStore.getState().conversations).toHaveLength(1);
      expect(useChatStore.getState().conversations[0].id).toBe('error-safe');
    });

    it('uses server title over empty local title', async () => {
      const conv = makeConversation({ id: 'title-test', title: '' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getConversations.mockResolvedValue({
        items: [
          { _id: 'title-test', title: 'Server Title', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ],
        total: 1,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'title-test');
      expect(updatedConv!.title).toBe('Server Title');
    });
  });

  // --------------------------------------------------------------------------
  // setConversationStreaming — unviewed tracking
  // --------------------------------------------------------------------------

  describe('setConversationStreaming — unviewed tracking', () => {
    it('does not trigger saveMessagesToServer when streaming stops (server handles persistence)', async () => {
      const conv = makeConversation({ id: 'auto-save-conv' });
      const msg = makeMessage({ id: 'auto-save-msg', content: 'Auto saved' });
      conv.messages = [msg];

      useChatStore.setState({ conversations: [conv] });

      // Start streaming
      useChatStore.getState().setConversationStreaming('auto-save-conv', {
        conversationId: 'auto-save-conv',
        messageId: 'auto-save-msg',
        client: {} as any,
      });

      expect(useChatStore.getState().isStreaming).toBe(true);

      // Stop streaming
      useChatStore.getState().setConversationStreaming('auto-save-conv', null);

      expect(useChatStore.getState().isStreaming).toBe(false);

      // Advance timers — no save should happen
      jest.advanceTimersByTime(1000);
      await jest.runAllTimersAsync();

      expect(mockApiClient.addMessage).not.toHaveBeenCalled();
    });

    it('marks conversation unviewed when streaming stops and a different conversation is active', () => {
      const conv1 = makeConversation({ id: 'active-conv' });
      const conv2 = makeConversation({ id: 'background-conv' });
      useChatStore.setState({
        conversations: [conv1, conv2],
        activeConversationId: 'active-conv',
      });

      useChatStore.getState().setConversationStreaming('background-conv', {
        conversationId: 'background-conv',
        messageId: 'msg-1',
        client: {} as any,
      });

      useChatStore.getState().setConversationStreaming('background-conv', null);

      expect(useChatStore.getState().hasUnviewedMessages('background-conv')).toBe(true);
      expect(useChatStore.getState().hasUnviewedMessages('active-conv')).toBe(false);
    });

    it('does not trigger save when streaming starts', () => {
      const conv = makeConversation({ id: 'no-save-start' });
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().setConversationStreaming('no-save-start', {
        conversationId: 'no-save-start',
        messageId: 'msg-1',
        client: {} as any,
      });

      jest.advanceTimersByTime(1000);

      // Should not have called addMessage
      expect(mockApiClient.addMessage).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // createConversation — MongoDB sync
  // --------------------------------------------------------------------------

  describe('createConversation', () => {
    it('creates conversation on server in MongoDB mode', async () => {
      const id = useChatStore.getState().createConversation();

      expect(id).toBeDefined();
      expect(useChatStore.getState().conversations).toHaveLength(1);
      expect(useChatStore.getState().activeConversationId).toBe(id);

      // Wait for async server call
      await jest.runAllTimersAsync();

      expect(mockApiClient.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          title: 'New Conversation',
        })
      );
    });

    it('does not call server in localStorage mode', () => {
      (global as any).__mockStorageMode = 'localStorage';

      // The store is already created, but createConversation checks
      // getStorageMode() internally on each call
      const id = useChatStore.getState().createConversation();

      expect(id).toBeDefined();
      expect(useChatStore.getState().conversations).toHaveLength(1);
      // In localStorage mode, should not call server
      expect(mockApiClient.createConversation).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // deleteConversation — MongoDB sync
  // --------------------------------------------------------------------------

  describe('deleteConversation', () => {
    it('removes conversation locally and from server in MongoDB mode', async () => {
      const conv1 = makeConversation({ id: 'del-1', title: 'Delete Me' });
      const conv2 = makeConversation({ id: 'del-2', title: 'Keep Me' });

      useChatStore.setState({
        conversations: [conv1, conv2],
        activeConversationId: 'del-1',
      });

      await useChatStore.getState().deleteConversation('del-1');

      // Local state should be updated immediately
      expect(useChatStore.getState().conversations).toHaveLength(1);
      expect(useChatStore.getState().conversations[0].id).toBe('del-2');

      // Active should switch to next
      expect(useChatStore.getState().activeConversationId).toBe('del-2');

      // Server should be called
      expect(mockApiClient.deleteConversation).toHaveBeenCalledWith('del-1');
    });

    it('sets active to null when deleting last conversation', async () => {
      const conv = makeConversation({ id: 'last-one' });

      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'last-one',
      });

      await useChatStore.getState().deleteConversation('last-one');

      expect(useChatStore.getState().conversations).toHaveLength(0);
      expect(useChatStore.getState().activeConversationId).toBeNull();
    });

    it('handles server 404 gracefully (conversation never saved)', async () => {
      mockApiClient.deleteConversation.mockRejectedValue(new Error('not found'));

      const conv = makeConversation({ id: 'never-saved' });
      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'never-saved',
      });

      // Should not throw
      await expect(
        useChatStore.getState().deleteConversation('never-saved')
      ).resolves.toBeUndefined();

      // Local state should still be cleaned up
      expect(useChatStore.getState().conversations).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // addMessage
  // --------------------------------------------------------------------------

  describe('addMessage', () => {
    it('adds message to conversation and returns message ID', () => {
      const conv = makeConversation({ id: 'add-msg-test' });
      useChatStore.setState({ conversations: [conv] });

      const msgId = useChatStore.getState().addMessage('add-msg-test', {
        role: 'user',
        content: 'Hello world',
      }, 'turn-1');

      expect(msgId).toBeDefined();

      const updated = useChatStore.getState().conversations.find(c => c.id === 'add-msg-test');
      expect(updated!.messages).toHaveLength(1);
      expect(updated!.messages[0].content).toBe('Hello world');
      expect(updated!.messages[0].role).toBe('user');
      expect(updated!.messages[0].turnId).toBe('turn-1');
      expect(updated!.messages[0].events).toEqual([]);
    });

    it('auto-generates title from first user message', () => {
      const conv = makeConversation({ id: 'auto-title', title: 'New Conversation' });
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().addMessage('auto-title', {
        role: 'user',
        content: 'What is the status of my ArgoCD applications?',
      });

      const updated = useChatStore.getState().conversations.find(c => c.id === 'auto-title');
      expect(updated!.title).toBe('What is the status of my ArgoCD applications?');
    });
  });

  // --------------------------------------------------------------------------
  // updateMessage
  // --------------------------------------------------------------------------

  describe('updateMessage', () => {
    it('updates message content and isFinal flag', () => {
      const conv = makeConversation({ id: 'update-test' });
      const msg = makeMessage({ id: 'updatable', content: '', isFinal: false });
      conv.messages = [msg];
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().updateMessage('update-test', 'updatable', {
        content: 'Final answer here',
        isFinal: true,
      });

      const updated = useChatStore.getState().conversations.find(c => c.id === 'update-test');
      expect(updated!.messages[0].content).toBe('Final answer here');
      expect(updated!.messages[0].isFinal).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // addEventToMessage
  // --------------------------------------------------------------------------

  describe('addEventToMessage', () => {
    it('appends A2A event to specific message', () => {
      const conv = makeConversation({ id: 'evt-test' });
      const msg = makeMessage({ id: 'msg-for-evt', role: 'assistant', events: [] });
      conv.messages = [msg];
      useChatStore.setState({ conversations: [conv] });

      const event = makeA2AEvent({ id: 'new-evt', type: 'tool_start' });
      useChatStore.getState().addEventToMessage('evt-test', 'msg-for-evt', event);

      const updated = useChatStore.getState().conversations.find(c => c.id === 'evt-test');
      expect(updated!.messages[0].events).toHaveLength(1);
      expect(updated!.messages[0].events[0].id).toBe('new-evt');
    });
  });

  // --------------------------------------------------------------------------
  // addA2AEvent
  // --------------------------------------------------------------------------

  describe('addA2AEvent', () => {
    it('adds event to both global and conversation events', () => {
      const conv = makeConversation({ id: 'global-evt' });
      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'global-evt',
      });

      const event = makeA2AEvent({ id: 'global-1' });
      useChatStore.getState().addA2AEvent(event);

      expect(useChatStore.getState().a2aEvents).toHaveLength(1);
      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'global-evt');
      expect(updatedConv!.a2aEvents).toHaveLength(1);
    });

    it('adds event to specific conversation when ID provided', () => {
      const conv1 = makeConversation({ id: 'specific-1' });
      const conv2 = makeConversation({ id: 'specific-2' });
      useChatStore.setState({
        conversations: [conv1, conv2],
        activeConversationId: 'specific-1',
      });

      const event = makeA2AEvent({ id: 'targeted' });
      useChatStore.getState().addA2AEvent(event, 'specific-2');

      // Event should be on conv2, not conv1
      const updated1 = useChatStore.getState().conversations.find(c => c.id === 'specific-1');
      const updated2 = useChatStore.getState().conversations.find(c => c.id === 'specific-2');
      expect(updated1!.a2aEvents).toHaveLength(0);
      expect(updated2!.a2aEvents).toHaveLength(1);
    });

    it('does not trigger periodic saves (server-side persistence handles this)', async () => {
      // Phase 3: The UI no longer saves to MongoDB. Adding many events should
      // never trigger saveMessagesToServer / apiClient.addMessage.
      const conv = makeConversation({ id: 'no-periodic-save' });
      const msg = makeMessage({ id: 'msg-nps', role: 'assistant', content: 'streaming...' });
      conv.messages = [msg];

      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'no-periodic-save',
      });

      // Add well over the old periodic-save threshold
      for (let i = 0; i < 25; i++) {
        useChatStore.getState().addA2AEvent(
          makeA2AEvent({ id: `evt-${i}` }),
          'no-periodic-save'
        );
      }

      await jest.runAllTimersAsync();

      // Should never have saved
      expect(mockApiClient.addMessage).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // cancelConversationRequest — persistence on cancel
  // --------------------------------------------------------------------------

  describe('cancelConversationRequest', () => {
    it('does not save to MongoDB after cancelling (server-side persistence handles it)', async () => {
      const conv = makeConversation({ id: 'cancel-save-test' });
      const msg = makeMessage({
        id: 'cancel-msg',
        role: 'assistant',
        content: 'partial response...',
        isFinal: false,
      });
      conv.messages = [msg];

      const mockClient = { abort: jest.fn() };

      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'cancel-save-test',
        streamingConversations: new Map([
          ['cancel-save-test', {
            conversationId: 'cancel-save-test',
            messageId: 'cancel-msg',
            client: mockClient as any,
          }],
        ]),
        isStreaming: true,
      });

      // Cancel the conversation
      useChatStore.getState().cancelConversationRequest('cancel-save-test');

      // Should have aborted the client
      expect(mockClient.abort).toHaveBeenCalled();

      // Streaming should be stopped
      expect(useChatStore.getState().isStreaming).toBe(false);
      expect(useChatStore.getState().streamingConversations.size).toBe(0);

      // No save should be triggered at any point — server handles persistence
      jest.advanceTimersByTime(600);
      await jest.runAllTimersAsync();

      expect(mockApiClient.addMessage).not.toHaveBeenCalled();
    });

    it('marks the streaming message as cancelled with isFinal=true', () => {
      const conv = makeConversation({ id: 'cancel-mark-test' });
      const msg = makeMessage({
        id: 'mark-msg',
        role: 'assistant',
        content: 'working on it...',
        isFinal: false,
      });
      conv.messages = [msg];

      const mockClient = { abort: jest.fn() };

      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'cancel-mark-test',
        streamingConversations: new Map([
          ['cancel-mark-test', {
            conversationId: 'cancel-mark-test',
            messageId: 'mark-msg',
            client: mockClient as any,
          }],
        ]),
        isStreaming: true,
      });

      useChatStore.getState().cancelConversationRequest('cancel-mark-test');

      const updated = useChatStore.getState().conversations.find(c => c.id === 'cancel-mark-test');
      const updatedMsg = updated!.messages.find(m => m.id === 'mark-msg');
      expect(updatedMsg!.isFinal).toBe(true);
      expect(updatedMsg!.content).toContain('Request cancelled');
    });

    it('does nothing when conversation is not streaming', () => {
      const conv = makeConversation({ id: 'not-streaming' });
      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'not-streaming',
      });

      // Should not throw
      useChatStore.getState().cancelConversationRequest('not-streaming');

      // No save triggered
      jest.advanceTimersByTime(1000);
      expect(mockApiClient.addMessage).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // clearA2AEvents
  // --------------------------------------------------------------------------

  describe('clearA2AEvents', () => {
    it('clears events for a specific conversation', () => {
      const conv = makeConversation({ id: 'clear-test' });
      conv.a2aEvents = [makeA2AEvent({ id: 'old-evt' })];
      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'clear-test',
      });

      useChatStore.getState().clearA2AEvents('clear-test');

      const updated = useChatStore.getState().conversations.find(c => c.id === 'clear-test');
      expect(updated!.a2aEvents).toHaveLength(0);
    });

    it('clears global events when no conversationId provided', () => {
      useChatStore.setState({
        a2aEvents: [makeA2AEvent({ id: 'global-old' })],
      });

      useChatStore.getState().clearA2AEvents();

      expect(useChatStore.getState().a2aEvents).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // evictOldMessageContent
  // --------------------------------------------------------------------------

  describe('evictOldMessageContent', () => {
    it('truncates content to 80-char preview for evicted messages', () => {
      const longContent = 'A'.repeat(500);
      const conv = makeConversation({ id: 'evict-test' });
      conv.messages = [
        makeMessage({ id: 'old-msg', content: longContent, role: 'assistant' }),
        makeMessage({ id: 'recent-msg', content: 'Keep this', role: 'user' }),
      ];
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().evictOldMessageContent('evict-test', ['old-msg']);

      const updated = useChatStore.getState().conversations.find(c => c.id === 'evict-test');
      expect(updated!.messages[0].content).toHaveLength(80);
      expect(updated!.messages[0].content).toBe('A'.repeat(80));
      // Recent message should be untouched
      expect(updated!.messages[1].content).toBe('Keep this');
    });

    it('clears rawStreamContent from evicted messages', () => {
      const conv = makeConversation({ id: 'raw-evict' });
      conv.messages = [
        makeMessage({
          id: 'stream-msg',
          content: 'Streamed content',
          rawStreamContent: 'Very long raw stream data...',
          role: 'assistant',
        }),
      ];
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().evictOldMessageContent('raw-evict', ['stream-msg']);

      const updated = useChatStore.getState().conversations.find(c => c.id === 'raw-evict');
      expect(updated!.messages[0].rawStreamContent).toBeUndefined();
    });

    it('clears events from evicted messages', () => {
      const event = makeA2AEvent({ id: 'evt-old' });
      const conv = makeConversation({ id: 'events-evict' });
      conv.messages = [
        makeMessage({
          id: 'msg-with-events',
          content: 'Old answer',
          events: [event],
          role: 'assistant',
        }),
      ];
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().evictOldMessageContent('events-evict', ['msg-with-events']);

      const updated = useChatStore.getState().conversations.find(c => c.id === 'events-evict');
      expect(updated!.messages[0].events).toEqual([]);
    });

    it('does nothing when messageIdsToEvict is empty', () => {
      const conv = makeConversation({ id: 'no-evict' });
      const originalContent = 'Keep this content intact';
      conv.messages = [
        makeMessage({ id: 'safe-msg', content: originalContent }),
      ];
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().evictOldMessageContent('no-evict', []);

      const updated = useChatStore.getState().conversations.find(c => c.id === 'no-evict');
      expect(updated!.messages[0].content).toBe(originalContent);
    });

    it('only evicts specified messages, leaving others untouched', () => {
      const conv = makeConversation({ id: 'selective-evict' });
      conv.messages = [
        makeMessage({ id: 'evict-me', content: 'X'.repeat(200), role: 'assistant' }),
        makeMessage({ id: 'keep-me', content: 'Y'.repeat(200), role: 'user' }),
        makeMessage({ id: 'also-evict', content: 'Z'.repeat(200), role: 'assistant' }),
      ];
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().evictOldMessageContent('selective-evict', ['evict-me', 'also-evict']);

      const updated = useChatStore.getState().conversations.find(c => c.id === 'selective-evict');
      // Evicted messages should be truncated
      expect(updated!.messages[0].content).toHaveLength(80);
      expect(updated!.messages[2].content).toHaveLength(80);
      // Kept message should be untouched
      expect(updated!.messages[1].content).toHaveLength(200);
    });

    it('does not affect other conversations', () => {
      const conv1 = makeConversation({ id: 'target-conv' });
      conv1.messages = [
        makeMessage({ id: 'target-msg', content: 'T'.repeat(200) }),
      ];
      const conv2 = makeConversation({ id: 'other-conv' });
      conv2.messages = [
        makeMessage({ id: 'other-msg', content: 'O'.repeat(200) }),
      ];
      useChatStore.setState({ conversations: [conv1, conv2] });

      useChatStore.getState().evictOldMessageContent('target-conv', ['target-msg']);

      const updated1 = useChatStore.getState().conversations.find(c => c.id === 'target-conv');
      const updated2 = useChatStore.getState().conversations.find(c => c.id === 'other-conv');
      expect(updated1!.messages[0].content).toHaveLength(80);
      expect(updated2!.messages[0].content).toHaveLength(200); // Untouched
    });

    it('handles messages with short content gracefully (no truncation needed)', () => {
      const conv = makeConversation({ id: 'short-content' });
      conv.messages = [
        makeMessage({ id: 'short-msg', content: 'Short', role: 'assistant' }),
      ];
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().evictOldMessageContent('short-content', ['short-msg']);

      const updated = useChatStore.getState().conversations.find(c => c.id === 'short-content');
      // Content shorter than 80 chars should remain as-is (slice returns full string)
      expect(updated!.messages[0].content).toBe('Short');
      expect(updated!.messages[0].events).toEqual([]);
    });

    it('handles non-existent message IDs gracefully (no crash)', () => {
      const conv = makeConversation({ id: 'ghost-ids' });
      conv.messages = [
        makeMessage({ id: 'real-msg', content: 'R'.repeat(200) }),
      ];
      useChatStore.setState({ conversations: [conv] });

      // Should not throw
      useChatStore.getState().evictOldMessageContent('ghost-ids', ['nonexistent-1', 'nonexistent-2']);

      // Existing message should be untouched
      const updated = useChatStore.getState().conversations.find(c => c.id === 'ghost-ids');
      expect(updated!.messages[0].content).toHaveLength(200);
    });

    it('handles non-existent conversation gracefully (no crash)', () => {
      const conv = makeConversation({ id: 'exists' });
      conv.messages = [makeMessage({ id: 'msg-1', content: 'data' })];
      useChatStore.setState({ conversations: [conv] });

      // Should not throw — conversation doesn't match
      useChatStore.getState().evictOldMessageContent('doesnt-exist', ['msg-1']);

      // Existing conversation should be untouched
      const updated = useChatStore.getState().conversations.find(c => c.id === 'exists');
      expect(updated!.messages[0].content).toBe('data');
    });
  });

  // --------------------------------------------------------------------------
  // Unviewed Conversations — state management
  // --------------------------------------------------------------------------

  describe('unviewedConversations', () => {
    it('starts with empty unviewed set', () => {
      expect(useChatStore.getState().unviewedConversations.size).toBe(0);
    });

    it('markConversationUnviewed adds conversation to the set', () => {
      useChatStore.getState().markConversationUnviewed('conv-a');

      expect(useChatStore.getState().hasUnviewedMessages('conv-a')).toBe(true);
      expect(useChatStore.getState().unviewedConversations.size).toBe(1);
    });

    it('markConversationUnviewed is idempotent', () => {
      useChatStore.getState().markConversationUnviewed('conv-a');
      useChatStore.getState().markConversationUnviewed('conv-a');

      expect(useChatStore.getState().unviewedConversations.size).toBe(1);
    });

    it('clearConversationUnviewed removes conversation from the set', () => {
      useChatStore.getState().markConversationUnviewed('conv-a');
      useChatStore.getState().markConversationUnviewed('conv-b');

      useChatStore.getState().clearConversationUnviewed('conv-a');

      expect(useChatStore.getState().hasUnviewedMessages('conv-a')).toBe(false);
      expect(useChatStore.getState().hasUnviewedMessages('conv-b')).toBe(true);
      expect(useChatStore.getState().unviewedConversations.size).toBe(1);
    });

    it('clearConversationUnviewed is safe for non-existent IDs', () => {
      useChatStore.getState().clearConversationUnviewed('nonexistent');

      expect(useChatStore.getState().unviewedConversations.size).toBe(0);
    });

    it('hasUnviewedMessages returns false for unknown conversations', () => {
      expect(useChatStore.getState().hasUnviewedMessages('unknown')).toBe(false);
    });

    it('tracks multiple unviewed conversations independently', () => {
      useChatStore.getState().markConversationUnviewed('conv-1');
      useChatStore.getState().markConversationUnviewed('conv-2');
      useChatStore.getState().markConversationUnviewed('conv-3');

      expect(useChatStore.getState().unviewedConversations.size).toBe(3);

      useChatStore.getState().clearConversationUnviewed('conv-2');

      expect(useChatStore.getState().hasUnviewedMessages('conv-1')).toBe(true);
      expect(useChatStore.getState().hasUnviewedMessages('conv-2')).toBe(false);
      expect(useChatStore.getState().hasUnviewedMessages('conv-3')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // setActiveConversation — clears unviewed flag
  // --------------------------------------------------------------------------

  describe('setActiveConversation — unviewed clearing', () => {
    it('clears unviewed flag when navigating to an unviewed conversation', () => {
      useChatStore.getState().markConversationUnviewed('conv-target');
      useChatStore.getState().markConversationUnviewed('conv-other');

      useChatStore.getState().setActiveConversation('conv-target');

      expect(useChatStore.getState().hasUnviewedMessages('conv-target')).toBe(false);
      expect(useChatStore.getState().hasUnviewedMessages('conv-other')).toBe(true);
      expect(useChatStore.getState().activeConversationId).toBe('conv-target');
    });

    it('does not add to unviewed set when navigating to a viewed conversation', () => {
      useChatStore.getState().setActiveConversation('conv-normal');

      expect(useChatStore.getState().hasUnviewedMessages('conv-normal')).toBe(false);
      expect(useChatStore.getState().unviewedConversations.size).toBe(0);
    });

    it('preserves other unviewed conversations when clearing one', () => {
      useChatStore.getState().markConversationUnviewed('conv-a');
      useChatStore.getState().markConversationUnviewed('conv-b');
      useChatStore.getState().markConversationUnviewed('conv-c');

      useChatStore.getState().setActiveConversation('conv-b');

      expect(useChatStore.getState().unviewedConversations.size).toBe(2);
      expect(useChatStore.getState().hasUnviewedMessages('conv-a')).toBe(true);
      expect(useChatStore.getState().hasUnviewedMessages('conv-b')).toBe(false);
      expect(useChatStore.getState().hasUnviewedMessages('conv-c')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // setConversationStreaming — marks unviewed on stream end
  // --------------------------------------------------------------------------

  describe('setConversationStreaming — unviewed marking', () => {
    it('marks conversation as unviewed when streaming ends on a non-active conversation', () => {
      const conv1 = makeConversation({ id: 'bg-conv' });
      const conv2 = makeConversation({ id: 'active-conv' });
      conv1.messages = [makeMessage({ id: 'bg-msg', content: 'background' })];

      useChatStore.setState({
        conversations: [conv1, conv2],
        activeConversationId: 'active-conv',
      });

      // Start streaming on background conversation
      useChatStore.getState().setConversationStreaming('bg-conv', {
        conversationId: 'bg-conv',
        messageId: 'bg-msg',
        client: {} as any,
      });

      // Stop streaming — should mark as unviewed since user is on a different conversation
      useChatStore.getState().setConversationStreaming('bg-conv', null);

      expect(useChatStore.getState().hasUnviewedMessages('bg-conv')).toBe(true);
    });

    it('does NOT mark conversation as unviewed when streaming ends on the active conversation', () => {
      const conv = makeConversation({ id: 'active-stream' });
      conv.messages = [makeMessage({ id: 'active-msg', content: 'active' })];

      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'active-stream',
      });

      // Start and stop streaming on the active conversation
      useChatStore.getState().setConversationStreaming('active-stream', {
        conversationId: 'active-stream',
        messageId: 'active-msg',
        client: {} as any,
      });
      useChatStore.getState().setConversationStreaming('active-stream', null);

      expect(useChatStore.getState().hasUnviewedMessages('active-stream')).toBe(false);
    });

    it('does NOT mark as unviewed when streaming starts (only on stop)', () => {
      const conv = makeConversation({ id: 'start-only' });

      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'other-conv',
      });

      // Start streaming on a non-active conversation
      useChatStore.getState().setConversationStreaming('start-only', {
        conversationId: 'start-only',
        messageId: 'msg-1',
        client: {} as any,
      });

      expect(useChatStore.getState().hasUnviewedMessages('start-only')).toBe(false);
    });

    it('full lifecycle: live → unviewed → cleared on navigation', () => {
      const conv1 = makeConversation({ id: 'lifecycle-conv' });
      const conv2 = makeConversation({ id: 'user-conv' });
      conv1.messages = [makeMessage({ id: 'lc-msg', content: 'lifecycle' })];

      useChatStore.setState({
        conversations: [conv1, conv2],
        activeConversationId: 'user-conv',
      });

      // Phase 1: Start streaming (live)
      useChatStore.getState().setConversationStreaming('lifecycle-conv', {
        conversationId: 'lifecycle-conv',
        messageId: 'lc-msg',
        client: {} as any,
      });
      expect(useChatStore.getState().isConversationStreaming('lifecycle-conv')).toBe(true);
      expect(useChatStore.getState().hasUnviewedMessages('lifecycle-conv')).toBe(false);

      // Phase 2: Stop streaming (becomes unviewed because user is on user-conv)
      useChatStore.getState().setConversationStreaming('lifecycle-conv', null);
      expect(useChatStore.getState().isConversationStreaming('lifecycle-conv')).toBe(false);
      expect(useChatStore.getState().hasUnviewedMessages('lifecycle-conv')).toBe(true);

      // Phase 3: User navigates to the conversation (unviewed is cleared)
      useChatStore.getState().setActiveConversation('lifecycle-conv');
      expect(useChatStore.getState().hasUnviewedMessages('lifecycle-conv')).toBe(false);
      expect(useChatStore.getState().activeConversationId).toBe('lifecycle-conv');
    });

    it('handles multiple background conversations completing independently', () => {
      const conv1 = makeConversation({ id: 'bg-1' });
      const conv2 = makeConversation({ id: 'bg-2' });
      const conv3 = makeConversation({ id: 'user-active' });
      conv1.messages = [makeMessage({ id: 'msg-bg1', content: 'bg1' })];
      conv2.messages = [makeMessage({ id: 'msg-bg2', content: 'bg2' })];

      useChatStore.setState({
        conversations: [conv1, conv2, conv3],
        activeConversationId: 'user-active',
      });

      // Start streaming on both background conversations
      useChatStore.getState().setConversationStreaming('bg-1', {
        conversationId: 'bg-1', messageId: 'msg-bg1', client: {} as any,
      });
      useChatStore.getState().setConversationStreaming('bg-2', {
        conversationId: 'bg-2', messageId: 'msg-bg2', client: {} as any,
      });

      // bg-1 finishes first
      useChatStore.getState().setConversationStreaming('bg-1', null);
      expect(useChatStore.getState().hasUnviewedMessages('bg-1')).toBe(true);
      expect(useChatStore.getState().hasUnviewedMessages('bg-2')).toBe(false);

      // User views bg-1
      useChatStore.getState().setActiveConversation('bg-1');
      expect(useChatStore.getState().hasUnviewedMessages('bg-1')).toBe(false);

      // bg-2 finishes
      useChatStore.getState().setConversationStreaming('bg-2', null);
      expect(useChatStore.getState().hasUnviewedMessages('bg-2')).toBe(true);
      expect(useChatStore.getState().hasUnviewedMessages('bg-1')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // isConversationStreaming — live status indicator
  // --------------------------------------------------------------------------

  describe('isConversationStreaming — live status', () => {
    it('returns true when conversation is actively streaming', () => {
      const conv = makeConversation({ id: 'stream-check' });
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().setConversationStreaming('stream-check', {
        conversationId: 'stream-check',
        messageId: 'msg-1',
        client: {} as any,
      });

      expect(useChatStore.getState().isConversationStreaming('stream-check')).toBe(true);
    });

    it('returns false when conversation is not streaming', () => {
      expect(useChatStore.getState().isConversationStreaming('not-streaming')).toBe(false);
    });

    it('returns false after streaming stops', () => {
      const conv = makeConversation({ id: 'was-streaming' });
      conv.messages = [makeMessage({ id: 'msg-ws', content: 'done' })];
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().setConversationStreaming('was-streaming', {
        conversationId: 'was-streaming',
        messageId: 'msg-ws',
        client: {} as any,
      });
      useChatStore.getState().setConversationStreaming('was-streaming', null);

      expect(useChatStore.getState().isConversationStreaming('was-streaming')).toBe(false);
    });

    it('tracks multiple streaming conversations independently', () => {
      const conv1 = makeConversation({ id: 'multi-1' });
      const conv2 = makeConversation({ id: 'multi-2' });
      conv1.messages = [makeMessage({ id: 'msg-m1' })];
      conv2.messages = [makeMessage({ id: 'msg-m2' })];

      useChatStore.setState({ conversations: [conv1, conv2] });

      useChatStore.getState().setConversationStreaming('multi-1', {
        conversationId: 'multi-1', messageId: 'msg-m1', client: {} as any,
      });
      useChatStore.getState().setConversationStreaming('multi-2', {
        conversationId: 'multi-2', messageId: 'msg-m2', client: {} as any,
      });

      expect(useChatStore.getState().isConversationStreaming('multi-1')).toBe(true);
      expect(useChatStore.getState().isConversationStreaming('multi-2')).toBe(true);

      useChatStore.getState().setConversationStreaming('multi-1', null);

      expect(useChatStore.getState().isConversationStreaming('multi-1')).toBe(false);
      expect(useChatStore.getState().isConversationStreaming('multi-2')).toBe(true);
    });

    it('updates global isStreaming based on any active streams', () => {
      const conv1 = makeConversation({ id: 'global-1' });
      const conv2 = makeConversation({ id: 'global-2' });
      conv1.messages = [makeMessage({ id: 'msg-g1' })];
      conv2.messages = [makeMessage({ id: 'msg-g2' })];
      useChatStore.setState({ conversations: [conv1, conv2] });

      expect(useChatStore.getState().isStreaming).toBe(false);

      useChatStore.getState().setConversationStreaming('global-1', {
        conversationId: 'global-1', messageId: 'msg-g1', client: {} as any,
      });
      expect(useChatStore.getState().isStreaming).toBe(true);

      useChatStore.getState().setConversationStreaming('global-2', {
        conversationId: 'global-2', messageId: 'msg-g2', client: {} as any,
      });
      expect(useChatStore.getState().isStreaming).toBe(true);

      useChatStore.getState().setConversationStreaming('global-1', null);
      expect(useChatStore.getState().isStreaming).toBe(true);

      useChatStore.getState().setConversationStreaming('global-2', null);
      expect(useChatStore.getState().isStreaming).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // inputRequiredConversations — CRUD
  // --------------------------------------------------------------------------

  describe('inputRequiredConversations', () => {
    it('starts with empty input-required set', () => {
      expect(useChatStore.getState().inputRequiredConversations.size).toBe(0);
    });

    it('markConversationInputRequired adds conversation to the set', () => {
      useChatStore.getState().markConversationInputRequired('conv-a');

      expect(useChatStore.getState().isConversationInputRequired('conv-a')).toBe(true);
      expect(useChatStore.getState().inputRequiredConversations.size).toBe(1);
    });

    it('markConversationInputRequired is idempotent', () => {
      useChatStore.getState().markConversationInputRequired('conv-a');
      useChatStore.getState().markConversationInputRequired('conv-a');

      expect(useChatStore.getState().inputRequiredConversations.size).toBe(1);
    });

    it('clearConversationInputRequired removes conversation from the set', () => {
      useChatStore.getState().markConversationInputRequired('conv-a');
      useChatStore.getState().markConversationInputRequired('conv-b');

      useChatStore.getState().clearConversationInputRequired('conv-a');

      expect(useChatStore.getState().isConversationInputRequired('conv-a')).toBe(false);
      expect(useChatStore.getState().isConversationInputRequired('conv-b')).toBe(true);
    });

    it('clearConversationInputRequired is safe for non-existent IDs', () => {
      useChatStore.getState().clearConversationInputRequired('nonexistent');

      expect(useChatStore.getState().inputRequiredConversations.size).toBe(0);
    });

    it('isConversationInputRequired returns false for unknown conversations', () => {
      expect(useChatStore.getState().isConversationInputRequired('unknown')).toBe(false);
    });

    it('tracks multiple input-required conversations independently', () => {
      useChatStore.getState().markConversationInputRequired('conv-1');
      useChatStore.getState().markConversationInputRequired('conv-2');
      useChatStore.getState().markConversationInputRequired('conv-3');

      expect(useChatStore.getState().inputRequiredConversations.size).toBe(3);

      useChatStore.getState().clearConversationInputRequired('conv-2');

      expect(useChatStore.getState().isConversationInputRequired('conv-1')).toBe(true);
      expect(useChatStore.getState().isConversationInputRequired('conv-2')).toBe(false);
      expect(useChatStore.getState().isConversationInputRequired('conv-3')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // setActiveConversation — clears input-required flag
  // --------------------------------------------------------------------------

  describe('setActiveConversation — input-required clearing', () => {
    it('clears input-required flag when navigating to a conversation', () => {
      useChatStore.getState().markConversationInputRequired('conv-target');
      useChatStore.getState().markConversationInputRequired('conv-other');

      useChatStore.getState().setActiveConversation('conv-target');

      expect(useChatStore.getState().isConversationInputRequired('conv-target')).toBe(false);
      expect(useChatStore.getState().isConversationInputRequired('conv-other')).toBe(true);
    });

    it('clears both unviewed and input-required when navigating', () => {
      useChatStore.getState().markConversationUnviewed('conv-a');
      useChatStore.getState().markConversationInputRequired('conv-a');

      useChatStore.getState().setActiveConversation('conv-a');

      expect(useChatStore.getState().hasUnviewedMessages('conv-a')).toBe(false);
      expect(useChatStore.getState().isConversationInputRequired('conv-a')).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // setConversationStreaming — clears input-required on resume
  // --------------------------------------------------------------------------

  describe('setConversationStreaming — input-required clearing', () => {
    it('clears input-required when streaming starts (user submitted input)', () => {
      useChatStore.getState().markConversationInputRequired('conv-hitl');

      const conv = makeConversation({ id: 'conv-hitl' });
      conv.messages = [makeMessage({ id: 'msg-1', content: 'test' })];
      useChatStore.setState({ conversations: [conv] });

      useChatStore.getState().setConversationStreaming('conv-hitl', {
        conversationId: 'conv-hitl',
        messageId: 'msg-1',
        client: {} as any,
      });

      expect(useChatStore.getState().isConversationInputRequired('conv-hitl')).toBe(false);
    });

    it('does NOT clear input-required for other conversations when one resumes', () => {
      useChatStore.getState().markConversationInputRequired('conv-a');
      useChatStore.getState().markConversationInputRequired('conv-b');

      const convA = makeConversation({ id: 'conv-a' });
      convA.messages = [makeMessage({ id: 'msg-a', content: 'test' })];
      useChatStore.setState({ conversations: [convA] });

      useChatStore.getState().setConversationStreaming('conv-a', {
        conversationId: 'conv-a',
        messageId: 'msg-a',
        client: {} as any,
      });

      expect(useChatStore.getState().isConversationInputRequired('conv-a')).toBe(false);
      expect(useChatStore.getState().isConversationInputRequired('conv-b')).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // addA2AEvent — marks input-required on UserInputMetaData artifact
  // --------------------------------------------------------------------------

  describe('addA2AEvent — input-required marking', () => {
    it('marks conversation as input-required when UserInputMetaData event arrives', () => {
      const conv = makeConversation({ id: 'conv-hitl' });
      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'conv-hitl',
      });

      useChatStore.getState().addA2AEvent({
        id: 'evt-1',
        type: 'artifact' as any,
        timestamp: new Date().toISOString(),
        artifact: {
          name: 'UserInputMetaData',
          parts: [{ kind: 'data', data: { input_fields: [] } }],
        } as any,
      }, 'conv-hitl');

      expect(useChatStore.getState().isConversationInputRequired('conv-hitl')).toBe(true);
    });

    it('does NOT mark as input-required for other artifact types', () => {
      const conv = makeConversation({ id: 'conv-normal' });
      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'conv-normal',
      });

      useChatStore.getState().addA2AEvent({
        id: 'evt-2',
        type: 'artifact' as any,
        timestamp: new Date().toISOString(),
        artifact: {
          name: 'partial_result',
          parts: [{ kind: 'text', text: 'hello' }],
        } as any,
      }, 'conv-normal');

      expect(useChatStore.getState().isConversationInputRequired('conv-normal')).toBe(false);
    });
  });

});
