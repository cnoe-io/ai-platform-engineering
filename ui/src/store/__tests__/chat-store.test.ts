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
    createConversation: jest.fn().mockResolvedValue({ conversation: { _id: 'server-generated-id' }, created: true }),
    deleteConversation: jest.fn().mockResolvedValue({ deleted: true }),
    updateConversation: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('@/lib/storage-config', () => ({
  getStorageMode: () => (global as any).__mockStorageMode,
  shouldUseLocalStorage: () => (global as any).__mockStorageMode === 'localStorage',
}));

jest.mock('@/lib/utils', () => ({
  generateId: () => `test-id-${Math.random().toString(36).slice(2, 9)}`,
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

jest.mock('@/lib/timeline-manager', () => ({
  SupervisorTimelineManager: {
    buildFromEvents: jest.fn().mockReturnValue([]),
  },
}));

// ============================================================================
// Imports — after mocks
// ============================================================================

import { useChatStore } from '../chat-store';
import { apiClient } from '@/lib/api-client';
import type { Conversation, ChatMessage } from '@/types/a2a';

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
    streamEvents: [],
    ...overrides,
  };
}

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 9)}`,
    role: 'user',
    content: 'Hello',
    timestamp: new Date(),
    ...overrides,
  };
}

function resetStore() {
  useChatStore.setState({
    conversations: [],
    activeConversationId: null,
    isStreaming: false,
    streamingConversations: new Map(),
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
    });

    it('still loads from server even when local messages exist (for cross-device sync)', async () => {
      const conv = makeConversation({ id: 'has-local' });
      conv.messages = [makeMessage({ id: 'existing-msg', content: 'Already here' })];
      useChatStore.setState({ conversations: [conv] });

      // Server may have new messages from another device
      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-1', message_id: 'existing-msg', conversation_id: 'has-local',
            role: 'user', content: 'Already here', created_at: '2026-01-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' },
          },
        ],
        total: 1,
      });

      await useChatStore.getState().loadMessagesFromServer('has-local');

      // Should still call API for cross-device sync
      expect(mockApiClient.getMessages).toHaveBeenCalled();
    });

    it('loads messages from MongoDB when local messages exist (cross-device sync)', async () => {
      // This simulates what happens after a page refresh or on a different device:
      // localStorage cache has message stubs (content, role, etc.).
      // We need to reload from MongoDB to restore full data.
      const conv = makeConversation({ id: 'stubs-no-events' });
      conv.messages = [
        makeMessage({ id: 'user-msg', role: 'user', content: 'List my apps' }),
        makeMessage({ id: 'asst-msg', role: 'assistant', content: 'Here are 5 apps...' }),
      ];
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
        },
        {
          _id: 'mongo-asst',
          message_id: 'asst-msg',
          conversation_id: 'stubs-no-events',
          role: 'assistant',
          content: 'Here are 5 apps...',
          created_at: '2026-01-01T00:00:01Z',
          metadata: { turn_id: 'turn-1', is_final: true },
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

      // API should have been called
      expect(mockApiClient.getMessages).toHaveBeenCalledWith('stubs-no-events', { page_size: 100 });

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'stubs-no-events');
      expect(updatedConv).toBeDefined();

      // Messages should be present from MongoDB
      expect(updatedConv!.messages).toHaveLength(2);
      expect(updatedConv!.messages[0].content).toBe('List my apps');
      expect(updatedConv!.messages[1].content).toBe('Here are 5 apps...');
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
          },
        ],
        total: 1,
      });

      await useChatStore.getState().loadMessagesFromServer('replace-feedback');

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'replace-feedback');

      // MongoDB messages replace local state
      expect(updatedConv!.messages).toHaveLength(1);

      // Local feedback is NOT preserved — server data replaces local entirely
      // (Server response has no feedback field, so it's undefined)
      expect(updatedConv!.messages[0].feedback).toBeUndefined();
    });

    it('still loads from server when conversation has local messages (for cross-device sync)', async () => {
      const conv = makeConversation({ id: 'has-conv-events' });
      conv.messages = [makeMessage({ id: 'msg-1', content: 'Has content' })];
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-1', message_id: 'msg-1', conversation_id: 'has-conv-events',
            role: 'user', content: 'Has content', created_at: '2026-01-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' },
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
        makeMessage({ id: 'msg-turn1-user', role: 'user', content: 'List my apps' }),
        makeMessage({ id: 'msg-turn1-asst', role: 'assistant', content: 'Here are 5 apps...' }),
      ];
      useChatStore.setState({ conversations: [conv] });

      // Server has 4 messages: 2 from turn 1 + 2 from turn 2 (sent from another device)
      const serverMessages = [
        {
          _id: 'mongo-1', message_id: 'msg-turn1-user', conversation_id: 'follow-up-sync',
          role: 'user', content: 'List my apps', created_at: '2026-02-01T00:00:00Z',
          metadata: { turn_id: 'turn-1' },
        },
        {
          _id: 'mongo-2', message_id: 'msg-turn1-asst', conversation_id: 'follow-up-sync',
          role: 'assistant', content: 'Here are 5 apps...', created_at: '2026-02-01T00:00:01Z',
          metadata: { turn_id: 'turn-1', is_final: true },
        },
        {
          _id: 'mongo-3', message_id: 'msg-turn2-user', conversation_id: 'follow-up-sync',
          role: 'user', content: 'Show details for app-1', created_at: '2026-02-01T00:01:00Z',
          metadata: { turn_id: 'turn-2' },
        },
        {
          _id: 'mongo-4', message_id: 'msg-turn2-asst', conversation_id: 'follow-up-sync',
          role: 'assistant', content: 'App-1 is healthy and synced.', created_at: '2026-02-01T00:01:01Z',
          metadata: { turn_id: 'turn-2', is_final: true },
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

    it('handles conversation with only user messages (no assistant) gracefully', async () => {
      const conv = makeConversation({ id: 'user-only' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-1', message_id: 'msg-user', conversation_id: 'user-only',
            role: 'user', content: 'Hello', created_at: '2026-02-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' },
          },
        ],
        total: 1,
      });

      await useChatStore.getState().loadMessagesFromServer('user-only');

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'user-only');
      expect(updatedConv!.messages).toHaveLength(1);
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
        makeMessage({ id: 'msg-user-1', role: 'user', content: 'List apps' }),
        makeMessage({
          id: 'msg-asst-1', role: 'assistant', content: 'Here are apps...',
          feedback: { type: 'like', submitted: true }, // Local feedback — will be lost
        }),
      ];
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-1', message_id: 'msg-user-1', conversation_id: 'feedback-replace-sync',
            role: 'user', content: 'List apps', created_at: '2026-02-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' },
          },
          {
            _id: 'mongo-2', message_id: 'msg-asst-1', conversation_id: 'feedback-replace-sync',
            role: 'assistant', content: 'Here are apps...', created_at: '2026-02-01T00:00:01Z',
            metadata: { turn_id: 'turn-1', is_final: true },
          },
          {
            _id: 'mongo-3', message_id: 'msg-user-2', conversation_id: 'feedback-replace-sync',
            role: 'user', content: 'Follow up', created_at: '2026-02-01T00:01:00Z',
            metadata: { turn_id: 'turn-2' },
          },
          {
            _id: 'mongo-4', message_id: 'msg-asst-2', conversation_id: 'feedback-replace-sync',
            role: 'assistant', content: 'Follow up response', created_at: '2026-02-01T00:01:01Z',
            metadata: { turn_id: 'turn-2', is_final: true },
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
        makeMessage({ id: 'msg-1', role: 'user', content: 'Hello' }),
        makeMessage({ id: 'msg-2', role: 'assistant', content: 'Hi there' }),
      ];
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-1', message_id: 'msg-1', conversation_id: 'no-dup-sync',
            role: 'user', content: 'Hello', created_at: '2026-02-01T00:00:00Z',
            metadata: { turn_id: 'turn-1' },
          },
          {
            _id: 'mongo-2', message_id: 'msg-2', conversation_id: 'no-dup-sync',
            role: 'assistant', content: 'Hi there', created_at: '2026-02-01T00:00:01Z',
            metadata: { turn_id: 'turn-1', is_final: true },
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
            metadata: { turn_id: 'turn-1' },
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
  // loadTurnsFromServer
  // --------------------------------------------------------------------------

  describe('loadTurnsFromServer', () => {
    it('hydrates supervisor conversations from the messages collection', async () => {
      const conv = makeConversation({ id: 'supervisor-history' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({
        items: [
          {
            _id: 'mongo-user',
            message_id: 'msg-user',
            conversation_id: 'supervisor-history',
            role: 'user',
            content: 'What changed in prod?',
            created_at: '2025-01-01T00:00:00Z',
            metadata: { turn_id: 'turn-supervisor' },
          },
          {
            _id: 'mongo-assistant',
            message_id: 'msg-assistant',
            conversation_id: 'supervisor-history',
            role: 'assistant',
            content: 'Here is the summary.',
            created_at: '2025-01-01T00:00:01Z',
            metadata: { turn_id: 'turn-supervisor', is_final: true },
          },
        ],
        total: 2,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadTurnsFromServer('supervisor-history');

      expect(mockApiClient.getMessages).toHaveBeenCalledWith(
        'supervisor-history',
        { page_size: 100 },
      );

      const updatedConv = useChatStore.getState().conversations.find(
        c => c.id === 'supervisor-history',
      );
      expect(updatedConv!.messages).toHaveLength(2);
      expect(updatedConv!.messages[1].content).toBe('Here is the summary.');
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

    it('does not preserve an active empty New Conversation placeholder absent from the server response', async () => {
      const emptyNew = makeConversation({ id: 'empty-new', title: 'New Conversation', messages: [] });
      const realConv = makeConversation({ id: 'real-conv', title: 'Real Conversation' });

      useChatStore.setState({
        conversations: [emptyNew, realConv],
        activeConversationId: 'empty-new',
      });

      mockApiClient.getConversations.mockResolvedValue({
        items: [
          {
            _id: 'real-conv',
            title: 'Real Conversation',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      const convIds = useChatStore.getState().conversations.map(c => c.id);
      expect(convIds).not.toContain('empty-new');
      expect(convIds).toContain('real-conv');
    });

    it('sorts empty New Conversation placeholders below titled conversations', async () => {
      mockApiClient.getConversations.mockResolvedValue({
        items: [
          {
            _id: 'empty-new',
            title: 'New Conversation',
            created_at: new Date('2026-01-02').toISOString(),
            updated_at: new Date('2026-01-02').toISOString(),
          },
          {
            _id: 'real-conv',
            title: 'Real Conversation',
            created_at: new Date('2026-01-01').toISOString(),
            updated_at: new Date('2026-01-01').toISOString(),
          },
        ],
        total: 2,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      expect(useChatStore.getState().conversations.map(c => c.id)).toEqual([
        'real-conv',
        'empty-new',
      ]);
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
    it('setConversationStreaming(null) triggers post-stream save', async () => {
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

      // Advance timers — post-stream save should happen
      jest.advanceTimersByTime(1000);
      await jest.runAllTimersAsync();

      expect(mockApiClient.addMessage).toHaveBeenCalled();
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
      const id = await useChatStore.getState().createConversation();

      expect(id).toBe('server-generated-id');
      expect(useChatStore.getState().conversations).toHaveLength(1);
      expect(useChatStore.getState().activeConversationId).toBe(id);

      expect(mockApiClient.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Conversation',
          client_type: 'webui',
        })
      );
    });

    it('does not call server in localStorage mode', async () => {
      (global as any).__mockStorageMode = 'localStorage';

      // The store is already created, but createConversation checks
      // getStorageMode() internally on each call
      const id = await useChatStore.getState().createConversation();

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

      // Save is triggered for the cancelled message (persistence of cancellation state)
      jest.advanceTimersByTime(600);
      await jest.runAllTimersAsync();

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
      const conv = makeConversation({ id: 'events-evict' });
      conv.messages = [
        makeMessage({
          id: 'msg-with-events',
          content: 'Old answer',
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
  // loadAutonomousConversationsFromService
  // --------------------------------------------------------------------------
  //
  // Mocks the autonomous api but lets the real synth module run so we
  // exercise the integration between synth and the chat-store dedup +
  // floor pass. Synth is pure, so this is safe.

  describe('loadAutonomousConversationsFromService', () => {
    let mockListTasks: jest.Mock;
    let mockListRuns: jest.Mock;

    beforeEach(() => {
      jest.useRealTimers(); // dynamic import + Promise.all need real timers
      mockListTasks = jest.fn();
      mockListRuns = jest.fn();
      jest.doMock('@/components/autonomous/api', () => ({
        autonomousApi: {
          listTasks: (...args: unknown[]) => mockListTasks(...args),
          listRuns: (...args: unknown[]) => mockListRuns(...args),
        },
      }));
    });

    afterEach(() => {
      jest.dontMock('@/components/autonomous/api');
    });

    function makeAutonomousTask(overrides: Record<string, unknown> = {}) {
      return {
        id: 't1',
        name: 'Cron task',
        description: null,
        agent: null,
        prompt: 'do the thing',
        llm_provider: null,
        trigger: { type: 'cron', schedule: '0 9 * * *' },
        enabled: true,
        timeout_seconds: null,
        max_retries: null,
        // No chat_conversation_id — exercises the uuid5 fallback.
        ...overrides,
      };
    }

    function makeRun(overrides: Record<string, unknown> = {}) {
      return {
        run_id: 'r1',
        task_id: 't1',
        task_name: 'Cron task',
        status: 'success',
        started_at: '2026-05-13T10:00:00.000Z',
        finished_at: '2026-05-13T10:01:00.000Z',
        response_full: 'done',
        events: [],
        ...overrides,
      };
    }

    it('synthesises the autonomous conversation under its canonical id', async () => {
      mockListTasks.mockResolvedValue([makeAutonomousTask({ id: 't1' })]);
      mockListRuns.mockResolvedValue([makeRun()]);

      await useChatStore.getState().loadAutonomousConversationsFromService();

      const conversations = useChatStore.getState().conversations;
      // uuid5('task:t1', _AUTONOMOUS_NS) — pinned by the synth fixture test.
      expect(conversations).toHaveLength(1);
      expect(conversations[0].id).toBe('a25e9fc5-8be0-528f-98d8-e2fd6f73dcc8');
      expect(conversations[0].source).toBe('autonomous');
      expect(conversations[0].task_id).toBe('t1');
    });

    it('filter-switch resync (same task, same runs) does not bump updatedAt', async () => {
      mockListTasks.mockResolvedValue([makeAutonomousTask()]);
      mockListRuns.mockResolvedValue([makeRun()]);

      await useChatStore.getState().loadAutonomousConversationsFromService();
      const firstTs = useChatStore.getState().conversations[0].updatedAt.getTime();

      // Simulate filter switch: same payload, second sync.
      await useChatStore.getState().loadAutonomousConversationsFromService();
      const secondTs = useChatStore.getState().conversations[0].updatedAt.getTime();

      expect(secondTs).toBe(firstTs);
    });

    it('monotonic floor — first sighting of a no-signal task mints Date.now() and reuses it across resyncs', async () => {
      mockListTasks.mockResolvedValue([makeAutonomousTask({ id: 't1' })]);
      mockListRuns.mockResolvedValue([]); // no runs, no signals

      await useChatStore.getState().loadAutonomousConversationsFromService();
      const firstTs = useChatStore.getState().conversations[0].updatedAt.getTime();
      // Floor must NOT be the synth NEVER (epoch 0); it's Date.now() on first sighting.
      expect(firstTs).toBeGreaterThan(1_000_000_000_000);

      await useChatStore.getState().loadAutonomousConversationsFromService();
      const secondTs = useChatStore.getState().conversations[0].updatedAt.getTime();

      expect(secondTs).toBe(firstTs);
    });

    it('new-run signals lift updatedAt above the previous value', async () => {
      mockListTasks.mockResolvedValue([makeAutonomousTask()]);
      mockListRuns.mockResolvedValueOnce([makeRun()]);

      await useChatStore.getState().loadAutonomousConversationsFromService();
      const firstTs = useChatStore.getState().conversations[0].updatedAt.getTime();

      mockListRuns.mockResolvedValueOnce([
        makeRun(),
        makeRun({
          run_id: 'r2',
          started_at: '2026-05-14T09:00:00.000Z',
          finished_at: '2026-05-14T09:01:00.000Z',
        }),
      ]);

      await useChatStore.getState().loadAutonomousConversationsFromService();
      const secondTs = useChatStore.getState().conversations[0].updatedAt.getTime();

      expect(secondTs).toBeGreaterThan(firstTs);
      expect(new Date(secondTs).toISOString()).toBe('2026-05-14T09:01:00.000Z');
    });

    it('two autonomous tasks with the same title remain distinct (id-based merge)', async () => {
      mockListTasks.mockResolvedValue([
        makeAutonomousTask({ id: 't1', name: 'Cleanup' }),
        makeAutonomousTask({ id: 't2', name: 'Cleanup' }),
      ]);
      mockListRuns.mockResolvedValue([]);

      await useChatStore.getState().loadAutonomousConversationsFromService();
      const ids = useChatStore.getState().conversations.map((c) => c.id);
      expect(new Set(ids).size).toBe(2);
    });

    it('manual user turns saved to the conversation survive a resync (merge contract)', async () => {
      mockListTasks.mockResolvedValue([makeAutonomousTask()]);
      mockListRuns.mockResolvedValue([makeRun()]);

      await useChatStore.getState().loadAutonomousConversationsFromService();
      const canonicalId = useChatStore.getState().conversations[0].id;

      // Append a manually-typed user turn (id is foreign to synth so
      // it must be preserved across resync).
      useChatStore.setState((s) => ({
        conversations: s.conversations.map((c) =>
          c.id === canonicalId
            ? {
                ...c,
                messages: [
                  ...c.messages,
                  makeMessage({
                    id: 'msg-typed-by-user',
                    role: 'user',
                    content: 'follow-up question',
                    timestamp: new Date('2026-05-13T11:00:00.000Z'),
                  }),
                ],
              }
            : c,
        ),
      }));

      // Resync.
      await useChatStore.getState().loadAutonomousConversationsFromService();

      const conv = useChatStore.getState().conversations[0];
      expect(conv.messages.find((m) => m.id === 'msg-typed-by-user')).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // onRehydrateStorage — legacy autonomous id cleanup (localStorage only)
  // --------------------------------------------------------------------------

  describe('onRehydrateStorage — legacy autonomous id cleanup', () => {
    // Rehydrate only runs when persist() is enabled (localStorage mode).
    // Uses jest.isolateModules to re-import the store with that flag.
    function legacyPayload() {
      return {
        state: {
          conversations: [
            {
              id: 'autonomous-some-task', // legacy non-UUID id
              source: 'autonomous',
              title: 'Legacy task',
              createdAt: new Date(0).toISOString(),
              updatedAt: new Date(0).toISOString(),
              messages: [],
            },
            {
              id: 'a25e9fc5-8be0-528f-98d8-e2fd6f73dcc8', // canonical UUIDv5
              source: 'autonomous',
              title: 'Canonical task',
              createdAt: new Date(0).toISOString(),
              updatedAt: new Date(0).toISOString(),
              messages: [],
            },
            {
              // Non-UUID web row — must survive (non-autonomous rows
              // own their ids, the rehydrate filter is autonomous-only).
              id: 'web-non-uuid-id',
              source: 'web',
              title: 'Web conv',
              createdAt: new Date(0).toISOString(),
              updatedAt: new Date(0).toISOString(),
              messages: [],
            },
          ],
          // Stale pointer at the dropped legacy row — must be cleared.
          activeConversationId: 'autonomous-some-task',
          selectedTurnIdsArray: [],
        },
        version: 0,
      };
    }

    it('drops legacy autonomous-${task.id} rows on rehydrate, keeps canonical UUIDv5 rows and non-autonomous rows', () => {
      jest.isolateModules(() => {
        // Persist key must match chat-store config; update both if it changes.
        localStorage.setItem(
          'caipe-chat-history',
          JSON.stringify(legacyPayload()),
        );

        (global as any).__mockStorageMode = 'localStorage';
        jest.doMock('@/lib/storage-config', () => ({
          getStorageMode: () => 'localStorage',
          shouldUseLocalStorage: () => true,
        }));

        const { useChatStore: freshStore } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../chat-store') as typeof import('../chat-store');

        const { conversations, activeConversationId } = freshStore.getState();
        const ids = conversations.map((c) => c.id);

        expect(ids).not.toContain('autonomous-some-task');
        expect(ids).toContain('a25e9fc5-8be0-528f-98d8-e2fd6f73dcc8');
        expect(ids).toContain('web-non-uuid-id');
        expect(activeConversationId).toBeNull();

        localStorage.removeItem('caipe-chat-history');
        (global as any).__mockStorageMode = 'mongodb';
      });
    });
  });

  // --------------------------------------------------------------------------
  // loadMessagesFromServer — a2aEvents preservation for autonomous
  // --------------------------------------------------------------------------

  describe('loadMessagesFromServer — a2aEvents preservation', () => {
    it('does NOT overwrite a2aEvents/streamEvents for source=autonomous', async () => {
      // Synth-aggregated events span multiple runs; the right-side
      // debug panel reads conv.a2aEvents.
      const synthEvents = [
        { id: 'evt-run1-0', type: 'task' } as any,
        { id: 'evt-run2-0', type: 'task' } as any,
      ];
      const conv = makeConversation({
        id: 'autonomous-canonical-1',
        messages: [
          makeMessage({
            id: 'task:t1:creation_intent',
            role: 'user',
            content: 'created',
          }),
          makeMessage({
            id: 'run:r1:response',
            role: 'assistant',
            content: 'done',
            events: [{ id: 'evt-run1-only', type: 'task' } as any],
          }),
        ],
      });
      (conv as any).source = 'autonomous';
      conv.a2aEvents = synthEvents;
      useChatStore.setState({ conversations: [conv] });

      // MongoDB returns last-turn events only — the reducer would
      // shrink conv.a2aEvents from "all runs" to "last run" if the
      // autonomous-source guard regressed.
      mockApiClient.getMessages.mockResolvedValueOnce({
        items: [
          {
            message_id: 'task:t1:creation_intent',
            role: 'user',
            content: 'created',
            created_at: new Date().toISOString(),
            a2a_events: [],
          },
          {
            message_id: 'run:r1:response',
            role: 'assistant',
            content: 'done',
            created_at: new Date().toISOString(),
            a2a_events: [{ id: 'evt-run1-only', type: 'task' }],
          },
        ],
        total: 2,
      } as any);

      await useChatStore
        .getState()
        .loadMessagesFromServer('autonomous-canonical-1', { force: true });

      const updated = useChatStore.getState().conversations[0];
      expect(updated.a2aEvents).toEqual(synthEvents);
    });

    it('DOES overwrite a2aEvents for non-autonomous conversations (existing behaviour)', async () => {
      const conv = makeConversation({
        id: 'web-conv-1',
        messages: [
          makeMessage({ id: 'msg-1', role: 'user', content: 'hi' }),
          makeMessage({ id: 'msg-2', role: 'assistant', content: 'hello' }),
        ],
      });
      conv.a2aEvents = [{ id: 'old-evt', type: 'task' } as any];
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValueOnce({
        items: [
          {
            message_id: 'msg-1',
            role: 'user',
            content: 'hi',
            created_at: new Date().toISOString(),
            a2a_events: [],
          },
          {
            message_id: 'msg-2',
            role: 'assistant',
            content: 'hello',
            created_at: new Date().toISOString(),
            a2a_events: [{ id: 'new-evt', type: 'task' }],
          },
        ],
        total: 2,
      } as any);

      await useChatStore
        .getState()
        .loadMessagesFromServer('web-conv-1', { force: true });

      const updated = useChatStore.getState().conversations[0];
      expect(updated.a2aEvents).toHaveLength(1);
      expect(updated.a2aEvents?.[0].id).toBe('new-evt');
    });
  });

  // --------------------------------------------------------------------------
  // Refresh state bug fixes — Inv-A (dedupe-by-id) and Inv-E (partialize scope)
  // --------------------------------------------------------------------------

  describe('refresh-state — autonomous loader dedupes by id (Inv-A)', () => {
    let mockListTasks: jest.Mock;
    let mockListRuns: jest.Mock;

    beforeEach(() => {
      jest.useRealTimers();
      mockListTasks = jest.fn();
      mockListRuns = jest.fn();
      jest.doMock('@/components/autonomous/api', () => ({
        autonomousApi: {
          listTasks: (...args: unknown[]) => mockListTasks(...args),
          listRuns: (...args: unknown[]) => mockListRuns(...args),
        },
      }));
    });

    afterEach(() => {
      jest.dontMock('@/components/autonomous/api');
    });

    // Canonical UUIDv5 of "task:t1" under the autonomous namespace —
    // pinned by the synth fixture; matches existing autonomous tests.
    const T1_CANONICAL_ID = 'a25e9fc5-8be0-528f-98d8-e2fd6f73dcc8';

    function makeAutonomousTask(overrides: Record<string, unknown> = {}) {
      return {
        id: 't1',
        name: 'Cron task',
        description: null,
        agent: null,
        prompt: 'do the thing',
        llm_provider: null,
        trigger: { type: 'cron', schedule: '0 9 * * *' },
        enabled: true,
        timeout_seconds: null,
        max_retries: null,
        ...overrides,
      };
    }

    function makeRun(overrides: Record<string, unknown> = {}) {
      return {
        run_id: 'r1',
        task_id: 't1',
        task_name: 'Cron task',
        status: 'success',
        started_at: '2026-05-13T10:00:00.000Z',
        finished_at: '2026-05-13T10:01:00.000Z',
        response_full: 'done',
        events: [],
        ...overrides,
      };
    }

    it('loadAutonomousConversationsFromService dedupes by id (Inv-A)', async () => {
      // Seed an entry whose id matches the canonical autonomous id but
      // whose source tag was lost (mimicking a persisted/API-fetched row
      // that pre-dates the autonomous-source label).
      const stripped: Conversation = makeConversation({
        id: T1_CANONICAL_ID,
        title: 'Persisted without source',
        source: undefined,
      });
      useChatStore.setState({
        conversations: [stripped],
        activeConversationId: T1_CANONICAL_ID,
      });

      mockListTasks.mockResolvedValue([makeAutonomousTask()]);
      mockListRuns.mockResolvedValue([makeRun()]);

      await useChatStore.getState().loadAutonomousConversationsFromService();

      const convs = useChatStore.getState().conversations;
      const matches = convs.filter((c) => c.id === T1_CANONICAL_ID);
      expect(matches).toHaveLength(1); // FR-001, FR-003
      expect(matches[0].source).toBe('autonomous'); // Inv-B
      // FR-002: active id still resolves to exactly one entry.
      const activeId = useChatStore.getState().activeConversationId;
      expect(activeId).toBe(T1_CANONICAL_ID);
      expect(convs.filter((c) => c.id === activeId)).toHaveLength(1);
    });

    it('autonomous loader preserves user-typed messages on dedupe', async () => {
      const userTyped = makeMessage({
        id: 'user-msg-1',
        role: 'user',
        content: 'hello',
        timestamp: new Date('2026-05-13T11:00:00.000Z'),
      });
      const stripped: Conversation = makeConversation({
        id: T1_CANONICAL_ID,
        source: undefined, // collision case: synth must claim this row
        messages: [userTyped],
      });
      useChatStore.setState({ conversations: [stripped] });

      mockListTasks.mockResolvedValue([makeAutonomousTask()]);
      mockListRuns.mockResolvedValue([makeRun()]);

      await useChatStore.getState().loadAutonomousConversationsFromService();

      const surviving = useChatStore
        .getState()
        .conversations.find((c) => c.id === T1_CANONICAL_ID);
      expect(surviving).toBeDefined();
      expect(surviving!.source).toBe('autonomous');
      // Synthesized canonical messages plus the user-typed message,
      // sorted by timestamp ascending.
      expect(
        surviving!.messages.find((m) => m.id === 'user-msg-1'),
      ).toBeDefined();
      expect(surviving!.messages.length).toBeGreaterThan(1);
      const ts = surviving!.messages.map((m) => m.timestamp.getTime());
      const sorted = [...ts].sort((a, b) => a - b);
      expect(ts).toEqual(sorted);
    });
  });

  describe('refresh-state — server loader dedupes by id (Inv-A)', () => {
    it('loadConversationsFromServer produces unique ids after local-only preservation', async () => {
      // Seed a local-only entry that is the active conversation. The
      // server response also returns the same id; without the dedupe
      // pass, both inserts would land in the merged list.
      const localActive = makeConversation({
        id: 'Y',
        title: 'Local copy',
        source: undefined,
        messages: [makeMessage({ id: 'local-msg-1' })],
      });
      useChatStore.setState({
        conversations: [localActive],
        activeConversationId: 'Y',
      });

      mockApiClient.getConversations.mockResolvedValue({
        items: [
          {
            _id: 'Y',
            title: 'Server copy',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      const matches = useChatStore
        .getState()
        .conversations.filter((c) => c.id === 'Y');
      expect(matches).toHaveLength(1);
    });
  });

  describe('refresh-state — onRehydrateStorage dedupes duplicate ids in persisted localStorage (Inv-A site 1)', () => {
    it('back-to-back-refresh resilience: dedupe on rehydrate, no network call', () => {
      jest.isolateModules(() => {
        const SHARED_ID = 'b25e9fc5-8be0-528f-98d8-e2fd6f73dcc8';
        const payload = {
          state: {
            conversations: [
              {
                id: SHARED_ID,
                source: undefined,
                title: 'Persisted without source',
                createdAt: new Date('2026-05-13T10:00:00.000Z').toISOString(),
                updatedAt: new Date('2026-05-13T10:00:00.000Z').toISOString(),
                messages: [
                  {
                    id: 'user-typed-1',
                    role: 'user',
                    content: 'manual reply',
                    timestamp: new Date(
                      '2026-05-13T11:00:00.000Z',
                    ).toISOString(),
                    events: [],
                  },
                ],
              },
              {
                id: SHARED_ID,
                source: 'autonomous',
                title: 'Synth row',
                createdAt: new Date('2026-05-13T09:00:00.000Z').toISOString(),
                updatedAt: new Date('2026-05-13T12:00:00.000Z').toISOString(),
                messages: [
                  {
                    id: 'synth-msg-1',
                    role: 'assistant',
                    content: 'task created',
                    timestamp: new Date(
                      '2026-05-13T09:00:00.000Z',
                    ).toISOString(),
                    events: [],
                  },
                ],
              },
            ],
            activeConversationId: SHARED_ID,
            selectedTurnIdsArray: [],
          },
          version: 0,
        };

        localStorage.setItem('caipe-chat-history', JSON.stringify(payload));

        (global as any).__mockStorageMode = 'localStorage';
        jest.doMock('@/lib/storage-config', () => ({
          getStorageMode: () => 'localStorage',
          shouldUseLocalStorage: () => true,
        }));

        const apiSpy = jest.fn();
        jest.doMock('@/lib/api-client', () => ({
          apiClient: {
            getConversations: (...args: unknown[]) => apiSpy(...args),
            getMessages: jest.fn().mockResolvedValue({ items: [], total: 0 }),
            addMessage: jest.fn(),
            createConversation: jest.fn(),
            deleteConversation: jest.fn(),
            updateConversation: jest.fn(),
          },
        }));
        const autonomousSpy = jest.fn();
        jest.doMock('@/components/autonomous/api', () => ({
          autonomousApi: {
            listTasks: (...args: unknown[]) => autonomousSpy(...args),
            listRuns: jest.fn(),
          },
        }));

        const { useChatStore: freshStore } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../chat-store') as typeof import('../chat-store');

        const convs = freshStore.getState().conversations;
        const sharedMatches = convs.filter((c) => c.id === SHARED_ID);
        // (a) exactly one entry survives.
        expect(sharedMatches).toHaveLength(1);
        // (b) the autonomous entry wins on collision (Inv-B).
        expect(sharedMatches[0].source).toBe('autonomous');
        // (c) the merged messages contain BOTH synth and user-typed
        // messages, sorted by timestamp ascending.
        const ids = sharedMatches[0].messages.map((m) => m.id);
        expect(ids).toContain('synth-msg-1');
        expect(ids).toContain('user-typed-1');
        const ts = sharedMatches[0].messages.map((m) => m.timestamp.getTime());
        const sorted = [...ts].sort((a, b) => a - b);
        expect(ts).toEqual(sorted);
        // (d) no network call was made between rehydrate and assertion.
        expect(apiSpy).not.toHaveBeenCalled();
        expect(autonomousSpy).not.toHaveBeenCalled();

        localStorage.removeItem('caipe-chat-history');
        (global as any).__mockStorageMode = 'mongodb';
      });
    });
  });

  describe('refresh-state — partialize denylist (Inv-E / Inv-F)', () => {
    it('strips top-level and recursive denylisted keys from persisted output', () => {
      jest.isolateModules(() => {
        (global as any).__mockStorageMode = 'localStorage';
        jest.doMock('@/lib/storage-config', () => ({
          getStorageMode: () => 'localStorage',
          shouldUseLocalStorage: () => true,
        }));

        // Capture the partialize fn by spying on createJSONStorage; simpler
        // path: rebuild the persist config inline by importing the store and
        // pulling state, then constructing what partialize would return.
        // The store's persist middleware exposes the partialize function via
        // its options closure, but it's not externally accessible. Instead,
        // we reproduce the contract by calling the helper directly and
        // asserting against the persisted shape constants exported via the
        // module-private TOP_LEVEL_DENYLIST / RECURSIVE_DENYLIST. Since
        // those constants are not exported, this test mirrors them locally
        // and validates the shape the persist write actually produces.

        // Mirror denylist constants from chat-store.ts. Keep in sync.
        const TOP_LEVEL = [
          'access_level', 'accessLevel', 'readOnlyReason', 'readOnly',
          'adminOrigin', 'isAdmin', 'canViewAdmin', 'sessionRole', 'authRole',
          'role', 'userRole',
        ];
        const RECURSIVE = TOP_LEVEL.filter((k) => k !== 'role');

        const { useChatStore: freshStore } =
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../chat-store') as typeof import('../chat-store');

        // Seed state — substring path: titles + message bodies that
        // contain the literal denylist substrings. Defeats any naive
        // serialized-string substring matcher.
        const conv: Conversation = makeConversation({
          id: 'partialize-test-1',
          title: 'access_level accessLevel isAdmin adminOrigin',
          source: undefined,
          messages: [
            makeMessage({
              id: 'um-1',
              role: 'user',
              content: 'access_level adminOrigin readOnlyReason',
            }),
            makeMessage({
              id: 'am-1',
              role: 'assistant',
              content: 'isAdmin canViewAdmin',
            }),
          ],
        });

        // Inject denylisted KEYS at root, conversation, and message
        // levels. The `as any` casts make the test compile against the
        // current ChatState / Conversation / ChatMessage types even
        // though they do not declare these keys.
        freshStore.setState({ conversations: [conv] });
        const stateNow = freshStore.getState() as any;
        stateNow.accessLevel = 'admin_audit';
        stateNow.readOnlyReason = 'admin_audit';
        stateNow.adminOrigin = 'audit-logs';
        stateNow.isAdmin = true;
        (stateNow.conversations[0] as any).access_level = 'admin_audit';
        (stateNow.conversations[0] as any).accessLevel = 'admin_audit';
        (stateNow.conversations[0] as any).readOnlyReason = 'admin_audit';
        (stateNow.conversations[0] as any).adminOrigin = 'audit-logs';
        (stateNow.conversations[0].messages[0] as any).accessLevel =
          'admin_audit';
        (stateNow.conversations[0].messages[0] as any).adminOrigin =
          'audit-logs';
        (stateNow.conversations[0].messages[0] as any).isAdmin = true;
        freshStore.setState(stateNow);

        // Read back what persist actually wrote to localStorage. The
        // persist middleware writes synchronously after the setState
        // above when storage is mocked to localStorage. The serialized
        // shape is `{ state: { ...partialize-output }, version }`.
        const raw = localStorage.getItem('caipe-chat-history');
        expect(raw).not.toBeNull();
        const parsed = JSON.parse(raw!);
        const persistedState = parsed.state ?? parsed;

        // (a) No own enumerable key of the root object matches TOP_LEVEL.
        const rootKeys = Object.keys(persistedState);
        for (const k of TOP_LEVEL) {
          expect(rootKeys).not.toContain(k);
        }

        // (b) No own enumerable key of any element of conversations[]
        // matches TOP_LEVEL.
        for (const c of persistedState.conversations as Record<string, unknown>[]) {
          const ck = Object.keys(c);
          for (const k of TOP_LEVEL) {
            expect(ck).not.toContain(k);
          }
        }

        // (c) Walk every nested object and assert no own enumerable key
        // matches RECURSIVE. Bare `role` is allowed (ChatMessage.role).
        const visit = (obj: unknown): void => {
          if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
            for (const k of Object.keys(obj as Record<string, unknown>)) {
              expect(RECURSIVE).not.toContain(k);
              visit((obj as Record<string, unknown>)[k]);
            }
          } else if (Array.isArray(obj)) {
            for (const v of obj) visit(v);
          }
        };
        visit(persistedState);

        localStorage.removeItem('caipe-chat-history');
        (global as any).__mockStorageMode = 'mongodb';
      });
    });
  });

  describe('refresh-state — cross-loader interleave (Inv-G)', () => {
    let mockListTasks: jest.Mock;
    let mockListRuns: jest.Mock;

    beforeEach(() => {
      jest.useRealTimers();
      mockListTasks = jest.fn();
      mockListRuns = jest.fn();
      jest.doMock('@/components/autonomous/api', () => ({
        autonomousApi: {
          listTasks: (...args: unknown[]) => mockListTasks(...args),
          listRuns: (...args: unknown[]) => mockListRuns(...args),
        },
      }));
    });

    afterEach(() => {
      jest.dontMock('@/components/autonomous/api');
    });

    it('server loader preserves autonomous-source entries written between snapshot-read and write', async () => {
      // Build a controllable promise the server loader will await; we
      // resolve it after the autonomous loader has already written.
      let resolveServer: (value: any) => void = () => {};
      const serverPromise = new Promise<any>((resolve) => {
        resolveServer = resolve;
      });
      mockApiClient.getConversations.mockImplementation(() => serverPromise);

      // Autonomous task with canonical id 'a25e9fc5-...' (from
      // uuidv5("task:t1")).
      mockListTasks.mockResolvedValue([
        {
          id: 't1',
          name: 'Cron task',
          description: null,
          agent: null,
          prompt: 'do the thing',
          llm_provider: null,
          trigger: { type: 'cron', schedule: '0 9 * * *' },
          enabled: true,
          timeout_seconds: null,
          max_retries: null,
        },
      ]);
      mockListRuns.mockResolvedValue([
        {
          run_id: 'r1',
          task_id: 't1',
          task_name: 'Cron task',
          status: 'success',
          started_at: '2026-05-13T10:00:00.000Z',
          finished_at: '2026-05-13T10:01:00.000Z',
          response_full: 'done',
          events: [],
        },
      ]);

      // Kick off server loader (do not await — it will block on
      // serverPromise).
      const serverDone = useChatStore.getState().loadConversationsFromServer();

      // Yield once so the server loader reads its snapshot before
      // awaiting the in-flight network call.
      await Promise.resolve();

      // Run the autonomous loader to completion: it writes
      // {id: 'a25e...', source: 'autonomous'} via callback-form set().
      await useChatStore
        .getState()
        .loadAutonomousConversationsFromService();

      // Now resolve the server loader's promise with one server-side
      // conversation 'S' that the autonomous loader does not know about.
      resolveServer({
        items: [
          {
            _id: 'S',
            title: 'Server-only conversation',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await serverDone;

      const ids = useChatStore
        .getState()
        .conversations.map((c) => c.id);
      // Both 'S' and the autonomous canonical id must survive the
      // server loader's set().
      expect(ids).toContain('S');
      const autonomousId = 'a25e9fc5-8be0-528f-98d8-e2fd6f73dcc8';
      expect(ids).toContain(autonomousId);
      const surviving = useChatStore
        .getState()
        .conversations.find((c) => c.id === autonomousId);
      expect(surviving!.source).toBe('autonomous');
    });

    it('server loader preserves autonomous synth messages on same-id collision', async () => {
      // The autonomous task's canonical id is also persisted server-side
      // (chat_history publisher creates a MongoDB row with messages: []),
      // so loadConversationsFromServer returns it. Without the same-id
      // preservation, the server's empty messages would clobber the
      // autonomous loader's synth messages, leaving the chat thread
      // empty until the next autonomous-loader tick — matching the
      // "manual chat history disappears" symptom.
      const autonomousId = 'a25e9fc5-8be0-528f-98d8-e2fd6f73dcc8';
      const synthMessage = makeMessage({
        id: 'creation-intent-1',
        role: 'user',
        content: 'do the thing',
        timestamp: new Date('2026-05-13T09:00:00.000Z'),
      });
      const userTyped = makeMessage({
        id: 'user-followup-1',
        role: 'user',
        content: 'follow up',
        timestamp: new Date('2026-05-13T11:00:00.000Z'),
      });
      const liveAutonomous = makeConversation({
        id: autonomousId,
        title: 'Cron task',
        source: 'autonomous',
        messages: [synthMessage, userTyped],
      });
      useChatStore.setState({ conversations: [liveAutonomous] });

      mockApiClient.getConversations.mockResolvedValue({
        items: [
          {
            _id: autonomousId,
            title: 'Cron task',
            owner_id: 'autonomous@system',
            source: 'autonomous',
            created_at: new Date('2026-05-13T08:00:00.000Z').toISOString(),
            updated_at: new Date('2026-05-13T09:00:00.000Z').toISOString(),
          },
        ],
        total: 1,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      const surviving = useChatStore
        .getState()
        .conversations.find((c) => c.id === autonomousId);
      expect(surviving).toBeDefined();
      expect(surviving!.source).toBe('autonomous');
      // Both the synth and user-typed messages survive the server write.
      const ids = surviving!.messages.map((m) => m.id);
      expect(ids).toContain('creation-intent-1');
      expect(ids).toContain('user-followup-1');
      expect(surviving!.messages).toHaveLength(2);
    });
  });

  describe('refresh-state — stale activeConversationId fallback (US3 — FR-006, FR-009)', () => {
    it('empty server response clears stale active id without fabricating a stub', async () => {
      useChatStore.setState({
        conversations: [],
        activeConversationId: 'STALE',
      });
      mockApiClient.getConversations.mockResolvedValue({
        items: [],
        total: 0,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      const state = useChatStore.getState();
      expect(state.conversations.find((c) => c.id === 'STALE')).toBeUndefined();
      expect(state.activeConversationId).toBeNull();
      expect(state.a2aEvents).toEqual([]);
    });

    it('server returns a different conversation, stale active id is replaced or cleared', async () => {
      useChatStore.setState({
        conversations: [],
        activeConversationId: 'STALE',
      });
      mockApiClient.getConversations.mockResolvedValue({
        items: [
          {
            _id: 'REAL',
            title: 'Real conversation',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        total: 1,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      const state = useChatStore.getState();
      expect(
        state.conversations.filter((c) => c.id === 'REAL'),
      ).toHaveLength(1);
      // Spec contract: stale pointer cleared; either null or fallback
      // to most-recent valid conversation is acceptable.
      expect(state.activeConversationId).not.toBe('STALE');
      expect([null, 'REAL']).toContain(state.activeConversationId);
    });
  });

  describe('refresh-state — dedupe is source-agnostic (US3 cross-source guard)', () => {
    let mockListTasks: jest.Mock;
    let mockListRuns: jest.Mock;

    beforeEach(() => {
      jest.useRealTimers();
      mockListTasks = jest.fn();
      mockListRuns = jest.fn();
      jest.doMock('@/components/autonomous/api', () => ({
        autonomousApi: {
          listTasks: (...args: unknown[]) => mockListTasks(...args),
          listRuns: (...args: unknown[]) => mockListRuns(...args),
        },
      }));
    });

    afterEach(() => {
      jest.dontMock('@/components/autonomous/api');
    });

    it('autonomous loader collapses (source: undefined) + (source: autonomous) entries with the same id to one', async () => {
      const SHARED = 'a25e9fc5-8be0-528f-98d8-e2fd6f73dcc8';
      const stripped = makeConversation({
        id: SHARED,
        source: undefined,
        title: 'web/persisted clone',
      });
      useChatStore.setState({ conversations: [stripped] });

      mockListTasks.mockResolvedValue([
        {
          id: 't1',
          name: 'Cron',
          description: null,
          agent: null,
          prompt: 'p',
          llm_provider: null,
          trigger: { type: 'cron', schedule: '0 9 * * *' },
          enabled: true,
          timeout_seconds: null,
          max_retries: null,
        },
      ]);
      mockListRuns.mockResolvedValue([]);

      await useChatStore.getState().loadAutonomousConversationsFromService();

      const matches = useChatStore
        .getState()
        .conversations.filter((c) => c.id === SHARED);
      expect(matches).toHaveLength(1);
      expect(matches[0].source).toBe('autonomous');
    });
  });

});
