/**
 * @jest-environment jsdom
 */
/**
 * Unit tests for chat-store.ts — MongoDB sync features
 *
 * Covers:
 * - serializeA2AEvent: strips raw payload, preserves key fields
 * - saveMessagesToServer: saves unsaved messages, tracks savedMessageIds, handles errors
 * - loadMessagesFromServer: loads from MongoDB, deserializes events, skips if already loaded
 * - loadConversationsFromServer: deletion sync across devices, active conversation cleanup
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

    it('does not re-save messages that were already saved', async () => {
      const conv = makeConversation({ id: 'dedup-test' });
      const msg = makeMessage({ id: 'msg-already-saved', role: 'user', content: 'Hi' });
      conv.messages = [msg];

      useChatStore.setState({ conversations: [conv] });

      // First save
      await useChatStore.getState().saveMessagesToServer('dedup-test');
      expect(mockApiClient.addMessage).toHaveBeenCalledTimes(1);

      // Second save — should skip
      mockApiClient.addMessage.mockClear();
      await useChatStore.getState().saveMessagesToServer('dedup-test');
      expect(mockApiClient.addMessage).not.toHaveBeenCalled();
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

    it('skips loading if conversation already has local messages', async () => {
      const conv = makeConversation({ id: 'has-local' });
      conv.messages = [makeMessage({ content: 'Already here' })];
      useChatStore.setState({ conversations: [conv] });

      await useChatStore.getState().loadMessagesFromServer('has-local');

      // Should not call API
      expect(mockApiClient.getMessages).not.toHaveBeenCalled();
    });

    it('skips loading if already loaded once', async () => {
      const conv = makeConversation({ id: 'already-loaded' });
      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getMessages.mockResolvedValue({ items: [], total: 0 });

      // First call
      await useChatStore.getState().loadMessagesFromServer('already-loaded');
      expect(mockApiClient.getMessages).toHaveBeenCalledTimes(1);

      // Second call — should skip
      mockApiClient.getMessages.mockClear();
      await useChatStore.getState().loadMessagesFromServer('already-loaded');
      expect(mockApiClient.getMessages).not.toHaveBeenCalled();
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

    it('preserves local messages when server conversation exists without messages', async () => {
      const localMsg = makeMessage({ id: 'local-msg', content: 'I have content' });
      const conv = makeConversation({ id: 'preserve-msgs', title: 'Has Messages', messages: [localMsg] });

      useChatStore.setState({ conversations: [conv] });

      mockApiClient.getConversations.mockResolvedValue({
        items: [
          { _id: 'preserve-msgs', title: 'Has Messages', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
        ],
        total: 1,
        page: 1,
        page_size: 100,
        has_more: false,
      });

      await useChatStore.getState().loadConversationsFromServer();

      const updatedConv = useChatStore.getState().conversations.find(c => c.id === 'preserve-msgs');
      expect(updatedConv!.messages).toHaveLength(1);
      expect(updatedConv!.messages[0].content).toBe('I have content');
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
  });
});
