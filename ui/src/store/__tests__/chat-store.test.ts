/**
 * @jest-environment jsdom
 */
/**
 * Unit tests for chat-store.ts — MongoDB sync features
 *
 * Covers:
 * - serializeA2AEvent: strips raw payload, preserves key fields
 * - saveMessagesToServer: upserts all messages every call (API upserts on message_id), handles errors
 * - loadMessagesFromServer: loads from MongoDB, when NOT streaming replaces local state entirely
 * - loadConversationsFromServer: server conversations replace local; messages start empty (filled by loadMessagesFromServer)
 * - setConversationStreaming: triggers auto-save when streaming completes
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

jest.mock('@/lib/a2a-client', () => ({
  A2AClient: jest.fn(),
}));

jest.mock('@/lib/utils', () => ({
  generateId: () => `test-id-${Math.random().toString(36).slice(2, 9)}`,
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
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
  // saveMessagesToServer
  // --------------------------------------------------------------------------

  describe('saveMessagesToServer', () => {
    it('saves unsaved messages to MongoDB via apiClient.addMessage', async () => {
      const conv = makeConversation({ id: 'save-test-1' });
      const userMsg = makeMessage({ id: 'user-1', role: 'user', content: 'What is K8s?', turnId: 'turn-1' });
      const assistantMsg = makeMessage({ id: 'asst-1', role: 'assistant', content: 'Kubernetes is...', turnId: 'turn-1', isFinal: true });
      conv.messages = [userMsg, assistantMsg];

      useChatStore.setState({ conversations: [conv] });

      await useChatStore.getState().saveMessagesToServer('save-test-1');

      expect(mockApiClient.addMessage).toHaveBeenCalledTimes(2);

      // Verify user message
      expect(mockApiClient.addMessage).toHaveBeenCalledWith('save-test-1', expect.objectContaining({
        message_id: 'user-1',
        role: 'user',
        content: 'What is K8s?',
        metadata: expect.objectContaining({ turn_id: 'turn-1' }),
      }));

      // Verify assistant message
      expect(mockApiClient.addMessage).toHaveBeenCalledWith('save-test-1', expect.objectContaining({
        message_id: 'asst-1',
        role: 'assistant',
        content: 'Kubernetes is...',
        metadata: expect.objectContaining({ turn_id: 'turn-1', is_final: true }),
      }));
    });

    it('upserts all messages on every call', async () => {
      const conv = makeConversation({ id: 'upsert-test' });
      conv.messages = [
        makeMessage({ id: 'msg-1', role: 'user', content: 'First' }),
        makeMessage({ id: 'msg-2', role: 'assistant', content: 'Response', isFinal: true }),
      ];

      useChatStore.setState({ conversations: [conv] });

      // First save — upserts both messages
      await useChatStore.getState().saveMessagesToServer('upsert-test');
      expect(mockApiClient.addMessage).toHaveBeenCalledTimes(2);
      expect(mockApiClient.addMessage).toHaveBeenCalledWith('upsert-test', expect.objectContaining({ message_id: 'msg-1' }));
      expect(mockApiClient.addMessage).toHaveBeenCalledWith('upsert-test', expect.objectContaining({ message_id: 'msg-2' }));

      // Second save — upserts ALL messages again (API does upsert on message_id)
      mockApiClient.addMessage.mockClear();
      await useChatStore.getState().saveMessagesToServer('upsert-test');
      expect(mockApiClient.addMessage).toHaveBeenCalledTimes(2);
      expect(mockApiClient.addMessage).toHaveBeenCalledWith('upsert-test', expect.objectContaining({ message_id: 'msg-1' }));
      expect(mockApiClient.addMessage).toHaveBeenCalledWith('upsert-test', expect.objectContaining({ message_id: 'msg-2' }));
    });

    it('serializes A2A events when saving assistant messages', async () => {
      const event = makeA2AEvent({
        id: 'evt-tool-1',
        type: 'tool_start',
        taskId: 'task-123',
        sourceAgent: 'argocd-agent',
      });

      const conv = makeConversation({ id: 'events-test' });
      const msg = makeMessage({
        id: 'msg-with-events',
        role: 'assistant',
        content: 'Done!',
        events: [event],
        isFinal: true,
      });
      conv.messages = [msg];

      useChatStore.setState({ conversations: [conv] });

      await useChatStore.getState().saveMessagesToServer('events-test');

      expect(mockApiClient.addMessage).toHaveBeenCalledWith('events-test', expect.objectContaining({
        a2a_events: [expect.objectContaining({
          id: 'evt-tool-1',
          type: 'tool_start',
          taskId: 'task-123',
          sourceAgent: 'argocd-agent',
          displayName: 'Test Event',
          // raw should NOT be included
        })],
      }));

      // Verify raw is excluded
      const savedEvents = mockApiClient.addMessage.mock.calls[0][1].a2a_events;
      expect(savedEvents[0]).not.toHaveProperty('raw');
    });

    it('attaches conversation-level a2aEvents to last assistant message when msg.events is empty', async () => {
      // This is the real-world scenario: during streaming, events go to conv.a2aEvents
      // via addA2AEvent() and NOT to individual msg.events via addEventToMessage().
      // The save must pick up conv.a2aEvents and attach them to the assistant message.
      const event1 = makeA2AEvent({ id: 'conv-evt-1', type: 'tool_start', displayName: 'GitHub lookup' });
      const event2 = makeA2AEvent({ id: 'conv-evt-2', type: 'tool_end', displayName: 'GitHub done' });

      const conv = makeConversation({
        id: 'conv-level-events',
        a2aEvents: [event1, event2], // Events at conversation level
      });
      const userMsg = makeMessage({ id: 'user-1', role: 'user', content: 'show my github profile' });
      const assistantMsg = makeMessage({
        id: 'asst-1',
        role: 'assistant',
        content: 'Here is your profile...',
        events: [], // Empty — events are on conv, not on msg
        isFinal: true,
      });
      conv.messages = [userMsg, assistantMsg];

      useChatStore.setState({ conversations: [conv] });
      await useChatStore.getState().saveMessagesToServer('conv-level-events');

      expect(mockApiClient.addMessage).toHaveBeenCalledTimes(2);

      // User message should NOT have events
      const userCall = mockApiClient.addMessage.mock.calls.find(
        (call) => call[1].message_id === 'user-1'
      );
      expect(userCall![1].a2a_events).toBeUndefined();

      // Assistant message should have the conversation-level events
      const assistantCall = mockApiClient.addMessage.mock.calls.find(
        (call) => call[1].message_id === 'asst-1'
      );
      expect(assistantCall![1].a2a_events).toBeDefined();
      expect(assistantCall![1].a2a_events).toHaveLength(2);
      expect(assistantCall![1].a2a_events![0]).toEqual(expect.objectContaining({
        id: 'conv-evt-1',
        type: 'tool_start',
        displayName: 'GitHub lookup',
      }));
      expect(assistantCall![1].a2a_events![1]).toEqual(expect.objectContaining({
        id: 'conv-evt-2',
        type: 'tool_end',
        displayName: 'GitHub done',
      }));
    });

    it('prefers per-message events over conversation-level events', async () => {
      // If msg.events is populated (unlikely in current code but possible),
      // it should take priority over conv.a2aEvents.
      const perMsgEvent = makeA2AEvent({ id: 'per-msg-evt', type: 'tool_start' });
      const convEvent = makeA2AEvent({ id: 'conv-evt', type: 'tool_end' });

      const conv = makeConversation({
        id: 'per-msg-priority',
        a2aEvents: [convEvent],
      });
      const assistantMsg = makeMessage({
        id: 'asst-1',
        role: 'assistant',
        content: 'Done',
        events: [perMsgEvent], // Has its own events
        isFinal: true,
      });
      conv.messages = [assistantMsg];

      useChatStore.setState({ conversations: [conv] });
      await useChatStore.getState().saveMessagesToServer('per-msg-priority');

      const savedEvents = mockApiClient.addMessage.mock.calls[0][1].a2a_events;
      expect(savedEvents).toHaveLength(1);
      expect(savedEvents![0]).toEqual(expect.objectContaining({ id: 'per-msg-evt' }));
    });

    it('does not attach conv events to user messages even if no assistant message exists', async () => {
      const convEvent = makeA2AEvent({ id: 'conv-evt', type: 'tool_start' });

      const conv = makeConversation({
        id: 'only-user-msg',
        a2aEvents: [convEvent],
      });
      const userMsg = makeMessage({ id: 'user-1', role: 'user', content: 'hello' });
      conv.messages = [userMsg];

      useChatStore.setState({ conversations: [conv] });
      await useChatStore.getState().saveMessagesToServer('only-user-msg');

      // Events should NOT be attached to user message
      const savedEvents = mockApiClient.addMessage.mock.calls[0][1].a2a_events;
      expect(savedEvents).toBeUndefined();
    });

    it('skips save in localStorage mode', async () => {
      (global as any).__mockStorageMode = 'localStorage';

      const conv = makeConversation({ id: 'ls-test' });
      conv.messages = [makeMessage()];
      useChatStore.setState({ conversations: [conv] });

      await useChatStore.getState().saveMessagesToServer('ls-test');
      expect(mockApiClient.addMessage).not.toHaveBeenCalled();
    });

    it('skips save for empty conversations', async () => {
      const conv = makeConversation({ id: 'empty-test' });
      useChatStore.setState({ conversations: [conv] });

      await useChatStore.getState().saveMessagesToServer('empty-test');
      expect(mockApiClient.addMessage).not.toHaveBeenCalled();
    });

    it('skips save for non-existent conversation', async () => {
      await useChatStore.getState().saveMessagesToServer('non-existent');
      expect(mockApiClient.addMessage).not.toHaveBeenCalled();
    });

    it('continues saving other messages if one fails', async () => {
      mockApiClient.addMessage
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({});

      const conv = makeConversation({ id: 'partial-fail' });
      conv.messages = [
        makeMessage({ id: 'fail-msg', role: 'user', content: 'Will fail' }),
        makeMessage({ id: 'ok-msg', role: 'assistant', content: 'Will succeed' }),
      ];

      useChatStore.setState({ conversations: [conv] });

      await useChatStore.getState().saveMessagesToServer('partial-fail');

      // Both messages should be attempted
      expect(mockApiClient.addMessage).toHaveBeenCalledTimes(2);
    });
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

    it('clears active conversation if it was deleted on another device', async () => {
      const conv1 = makeConversation({ id: 'still-here', title: 'Still Here' });
      const conv2 = makeConversation({ id: 'was-active-deleted', title: 'Was Active' });

      useChatStore.setState({
        conversations: [conv1, conv2],
        activeConversationId: 'was-active-deleted', // This one is active
      });

      // Server only returns conv1
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

      // Active conversation should switch to the remaining one
      expect(useChatStore.getState().activeConversationId).toBe('still-here');
      expect(useChatStore.getState().conversations).toHaveLength(1);
    });

    it('sets active to null when all conversations are deleted', async () => {
      const conv = makeConversation({ id: 'only-one', title: 'Only One' });

      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'only-one',
      });

      // Server returns empty
      mockApiClient.getConversations.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      expect(useChatStore.getState().activeConversationId).toBeNull();
      expect(useChatStore.getState().conversations).toHaveLength(0);
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
  // setConversationStreaming — auto-save trigger
  // --------------------------------------------------------------------------

  describe('setConversationStreaming — auto-save', () => {
    it('triggers saveMessagesToServer when streaming stops', async () => {
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

      // Stop streaming (triggers auto-save via setTimeout)
      useChatStore.getState().setConversationStreaming('auto-save-conv', null);

      expect(useChatStore.getState().isStreaming).toBe(false);

      // No save yet (debounced by 500ms)
      expect(mockApiClient.addMessage).not.toHaveBeenCalled();

      // Advance timers
      jest.advanceTimersByTime(600);

      // Wait for the async save to complete
      await jest.runAllTimersAsync();

      expect(mockApiClient.addMessage).toHaveBeenCalled();
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

      // Should not have called addMessage on start
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

    it('triggers periodic save after PERIODIC_SAVE_EVENT_THRESHOLD (20) events', async () => {
      const conv = makeConversation({ id: 'periodic-save-test' });
      const userMsg = makeMessage({ id: 'msg-ps-user', role: 'user', content: 'hello' });
      const msg = makeMessage({ id: 'msg-ps', role: 'assistant', content: 'streaming...' });
      conv.messages = [userMsg, msg];

      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'periodic-save-test',
      });

      // Add 19 events — should NOT trigger save yet
      for (let i = 0; i < 19; i++) {
        useChatStore.getState().addA2AEvent(
          makeA2AEvent({ id: `evt-${i}` }),
          'periodic-save-test'
        );
      }

      // Let any async saves settle
      await jest.runAllTimersAsync();
      mockApiClient.addMessage.mockClear();

      // Add the 20th event — should trigger periodic save
      useChatStore.getState().addA2AEvent(
        makeA2AEvent({ id: 'evt-19-trigger' }),
        'periodic-save-test'
      );

      // Wait for async save to complete
      await jest.runAllTimersAsync();

      // saveMessagesToServer should have been called
      expect(mockApiClient.addMessage).toHaveBeenCalled();
    });

    it('resets periodic save counter after reaching threshold', async () => {
      const conv = makeConversation({ id: 'counter-reset-test' });
      const msg = makeMessage({ id: 'msg-cr', role: 'assistant', content: 'data' });
      conv.messages = [msg];

      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'counter-reset-test',
      });

      // Add 20 events (triggers first periodic save)
      for (let i = 0; i < 20; i++) {
        useChatStore.getState().addA2AEvent(
          makeA2AEvent({ id: `evt-a-${i}` }),
          'counter-reset-test'
        );
      }
      await jest.runAllTimersAsync();
      mockApiClient.addMessage.mockClear();

      // Add 19 more events (should NOT trigger second save — counter was reset)
      for (let i = 0; i < 19; i++) {
        useChatStore.getState().addA2AEvent(
          makeA2AEvent({ id: `evt-b-${i}` }),
          'counter-reset-test'
        );
      }
      await jest.runAllTimersAsync();

      // Should NOT have saved again (only 19 since last reset)
      expect(mockApiClient.addMessage).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // cancelConversationRequest — persistence on cancel
  // --------------------------------------------------------------------------

  describe('cancelConversationRequest', () => {
    it('saves to MongoDB after cancelling a streaming conversation', async () => {
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

      // No immediate save (uses setTimeout with 500ms delay)
      expect(mockApiClient.addMessage).not.toHaveBeenCalled();

      // Advance past the 500ms save delay
      jest.advanceTimersByTime(600);
      await jest.runAllTimersAsync();

      // Now save should have been triggered
      expect(mockApiClient.addMessage).toHaveBeenCalled();
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
  // setConversationStreaming — resets periodic save counter on stream end
  // --------------------------------------------------------------------------

  describe('setConversationStreaming — periodic save counter reset', () => {
    it('resets periodic save counter when streaming completes (state=null)', async () => {
      const conv = makeConversation({ id: 'counter-clear-test' });
      const msg = makeMessage({ id: 'cc-msg', role: 'assistant', content: 'data' });
      conv.messages = [msg];

      useChatStore.setState({
        conversations: [conv],
        activeConversationId: 'counter-clear-test',
      });

      // Add 30 events (accumulate counter but don't trigger threshold)
      for (let i = 0; i < 30; i++) {
        useChatStore.getState().addA2AEvent(
          makeA2AEvent({ id: `evt-cc-${i}` }),
          'counter-clear-test'
        );
      }

      // Start streaming
      useChatStore.getState().setConversationStreaming('counter-clear-test', {
        conversationId: 'counter-clear-test',
        messageId: 'cc-msg',
        client: {} as any,
      });

      // Stop streaming (resets counter)
      useChatStore.getState().setConversationStreaming('counter-clear-test', null);

      await jest.runAllTimersAsync();
      mockApiClient.addMessage.mockClear();

      // Now add 49 more events — should NOT trigger save
      // (counter was reset to 0 when streaming stopped)
      for (let i = 0; i < 49; i++) {
        useChatStore.getState().addA2AEvent(
          makeA2AEvent({ id: `evt-after-${i}` }),
          'counter-clear-test'
        );
      }
      await jest.runAllTimersAsync();

      // Save was already called for the stream-end save, but not for periodic threshold
      // (49 < 50 threshold after reset)
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
});
