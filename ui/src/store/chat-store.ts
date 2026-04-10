import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Conversation, ChatMessage, MessageFeedback, TurnStatus } from "@/types/a2a";
import { StreamEvent } from "@/components/dynamic-agents/sse-types";
import { generateId } from "@/lib/utils";
import type { StreamAdapter } from "@/lib/streaming";
import { apiClient } from "@/lib/api-client";
import { getStorageMode, shouldUseLocalStorage } from "@/lib/storage-config";
import { TimelineManager } from "@/lib/timeline-manager";
import { parsePlanStepsFromTodos } from "@/lib/timeline-parsers";
import { streamAGUIEvents } from "@/lib/agui/hooks";
import type { InputRequiredPayload } from "@/lib/agui/types";

/** Minimal interface required for streaming client references. */
interface AbortableClient {
  abort(): void;
}

// Track streaming state per conversation
interface StreamingState {
  conversationId: string;
  messageId: string;
  /** Streaming client — only abort() is required */
  client: AbortableClient;
  // For Dynamic Agents: adapter reference for backend cancellation
  streamAdapter?: StreamAdapter;
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  isStreaming: boolean;
  streamingConversations: Map<string, StreamingState>;
  pendingMessage: string | null; // Message to auto-submit when ChatPanel mounts

  // Per-turn event tracking: selectedTurnId per conversation
  selectedTurnIds: Map<string, string>; // conversationId -> turnId

  // Conversations with new responses the user hasn't viewed yet
  unviewedConversations: Set<string>;

  // Conversations where the agent is waiting for user input (HITL)
  inputRequiredConversations: Set<string>;

  // Actions
  createConversation: (agentId?: string) => string;
  setActiveConversation: (id: string) => void;
  addMessage: (conversationId: string, message: Omit<ChatMessage, "id" | "timestamp">, turnId?: string, messageId?: string) => string;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  appendToMessage: (conversationId: string, messageId: string, content: string) => void;
  setStreaming: (streaming: boolean) => void;
  setConversationStreaming: (conversationId: string, state: StreamingState | null) => void;
  isConversationStreaming: (conversationId: string) => boolean;
  cancelConversationRequest: (conversationId: string) => void;
  // Stream events (for Dynamic Agents)
  addStreamEvent: (event: StreamEvent, conversationId?: string) => void;
  clearStreamEvents: (conversationId?: string) => void;
  getConversationStreamEvents: (conversationId: string) => StreamEvent[];
  deleteConversation: (id: string) => Promise<void>;
  clearAllConversations: () => void;
  getActiveConversation: () => Conversation | undefined;
  updateMessageFeedback: (conversationId: string, messageId: string, feedback: MessageFeedback) => void;
  updateConversationSharing: (conversationId: string, sharing: Conversation['sharing']) => void;
  updateConversationTitle: (conversationId: string, title: string) => Promise<void>;
  setPendingMessage: (message: string | null) => void;
  consumePendingMessage: () => string | null;
  loadConversationsFromServer: () => Promise<void>; // Load conversations from server (MongoDB mode only)
  recoverInterruptedTask: (conversationId: string, messageId: string, endpoint: string, accessToken?: string) => Promise<boolean>; // Level 2: Poll tasks/get for interrupted messages
  loadMessagesFromServer: (conversationId: string, options?: { force?: boolean }) => Promise<void>; // Load messages from MongoDB when opening conversation
  saveMessagesToServer: (conversationId: string) => Promise<void>; // Save messages to MongoDB via upsert (idempotent)
  loadTurnsFromServer: (conversationId: string) => Promise<void>; // No-op stub — Supervisor path will be restored in Phase 4
  evictOldMessageContent: (conversationId: string, messageIdsToEvict: string[]) => void; // Evict content from old messages to free memory

  /**
   * Send a message using the SSE endpoint (Platform Engineer only).
   * Returns once the stream has completed or errored.
   */
  sendMessage: (params: {
    message: string;
    conversationId?: string;
    endpoint?: string;
    accessToken?: string;
    userEmail?: string;
    userName?: string;
    userImage?: string;
  }) => Promise<void>;

  // Unviewed conversation actions
  markConversationUnviewed: (conversationId: string) => void;
  clearConversationUnviewed: (conversationId: string) => void;
  hasUnviewedMessages: (conversationId: string) => boolean;

  // Input-required conversation actions (HITL)
  markConversationInputRequired: (conversationId: string) => void;
  clearConversationInputRequired: (conversationId: string) => void;
  isConversationInputRequired: (conversationId: string) => boolean;

  // Turn selection actions for per-message event tracking
  setSelectedTurn: (conversationId: string, turnId: string | null) => void;
  getSelectedTurnId: (conversationId?: string) => string | null;
  isMessageSelectable: () => boolean;
  getTurnCount: (conversationId?: string) => number;
  getCurrentTurnIndex: (conversationId?: string) => number;
}

// Track loading state to prevent multiple simultaneous loads
let isLoadingConversations = false;

// Track in-flight and recently completed message loads to prevent:
// 1. Concurrent requests for the same conversation
// 2. Rapid re-fetches caused by React re-render loops (useEffect → store update → re-render)
// Maps conversationId → timestamp of last completed load. Calls within the cooldown
// window are skipped unless force=true (manual reload).
const messageLoadState = new Map<string, { inFlight: boolean; lastLoadedAt: number }>();
const MESSAGE_LOAD_COOLDOWN_MS = 5000; // 5 second cooldown between automatic syncs

/**
 * Collapse per-token content events into one content event per tool boundary.
 *
 * During streaming, hundreds of tiny `content` events are emitted (one per LLM
 * token). For persistence we merge consecutive content events (same namespace)
 * into a single event, flushing whenever a non-content event appears or the
 * namespace changes. This preserves the interleaved content↔tool ordering that
 * `DATimelineManager` needs while reducing storage by ~95%.
 *
 * Non-content events (tool_start, tool_end, warning, error, input_required)
 * pass through unchanged.
 */
function collapseStreamEvents(events: StreamEvent[]): StreamEvent[] {
  const result: StreamEvent[] = [];
  let contentBuffer = "";
  let bufferNamespace: string[] = [];
  let bufferTimestamp: Date | null = null;
  let bufferId: string | null = null;

  const flushContent = () => {
    if (contentBuffer && bufferId) {
      result.push({
        id: bufferId,
        timestamp: bufferTimestamp!,
        type: "content",
        raw: undefined,
        namespace: bufferNamespace,
        content: contentBuffer,
      });
      contentBuffer = "";
      bufferNamespace = [];
      bufferTimestamp = null;
      bufferId = null;
    }
  };

  for (const event of events) {
    if (event.type === "content") {
      const ns = event.namespace || [];
      const nsKey = ns.join("/");
      const bufNsKey = bufferNamespace.join("/");

      // Flush if namespace changed
      if (contentBuffer && nsKey !== bufNsKey) {
        flushContent();
      }

      // Start or extend buffer
      if (!bufferId) {
        bufferId = event.id;
        bufferTimestamp = event.timestamp;
        bufferNamespace = ns;
      }
      contentBuffer += event.content || "";
    } else {
      // Non-content event: flush any pending content, then pass through
      flushContent();
      result.push(event);
    }
  }

  // Flush remaining content
  flushContent();

  return result;
}

/** Serialize a StreamEvent for MongoDB storage.
 *  Strips `raw` to avoid circular refs / large payloads. */
function serializeStreamEvent(event: StreamEvent): Record<string, unknown> {
  return {
    id: event.id,
    timestamp: event.timestamp,
    type: event.type,
    taskId: event.taskId,
    isFinal: event.isFinal,
    namespace: event.namespace,
    // Structured event data
    toolData: event.toolData,
    warningData: event.warningData,
    inputRequiredData: event.inputRequiredData,
    // Content (collapsed content events carry the merged text)
    content: event.content,
    // Display content (for error events)
    displayContent: event.displayContent,
    // HITL support
    contextId: event.contextId,
    metadata: event.metadata,
    // Note: `raw` is intentionally omitted
  };
}

// Track in-flight saves to prevent loadMessagesFromServer from overwriting
// the correct in-memory state with stale MongoDB data while a save is pending.
const pendingSaveTimestamps = new Map<string, number>();
const PENDING_SAVE_GRACE_MS = 5000; // 5 second grace period


// Create store with conditional persistence
const storeImplementation = (set: any, get: any) => ({
      conversations: [],
      activeConversationId: null,
      isStreaming: false,
      streamingConversations: new Map<string, StreamingState>(),
      pendingMessage: null,
      selectedTurnIds: new Map<string, string>(),
      unviewedConversations: new Set<string>(),
      inputRequiredConversations: new Set<string>(),

      createConversation: (agentId?: string) => {
        const id = generateId();
        const newConversation: Conversation = {
          id,
          title: "New Conversation",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [],
          streamEvents: [], // Initialize with empty stream events for Dynamic Agents
          agent_id: agentId, // Dynamic agent ID; undefined = Platform Engineer
        };

        const storageMode = getStorageMode();

        // In MongoDB mode: create on server first
        // In localStorage mode: create locally
        if (storageMode === 'mongodb') {
          // MongoDB mode: Create on server with the same ID used locally
          apiClient.createConversation({
            id,
            title: newConversation.title,
            agent_id: agentId, // Pass agent_id to MongoDB
          }).then(() => {
            console.log('[ChatStore] Created conversation in MongoDB:', id);
          }).catch((error) => {
            console.error('[ChatStore] Failed to create conversation in MongoDB:', error);
          });
        }

        // Update local state (in localStorage mode, this persists via Zustand)
        set((state: ChatState) => ({
          conversations: [newConversation, ...state.conversations],
          activeConversationId: id,
        }));

        return id;
      },

      setActiveConversation: (id: string) => {
        const prev = get();
        const newUnviewed = new Set(prev.unviewedConversations);
        newUnviewed.delete(id);
        const newInputRequired = new Set(prev.inputRequiredConversations);
        newInputRequired.delete(id);
        set({
          activeConversationId: id,
          unviewedConversations: newUnviewed,
          inputRequiredConversations: newInputRequired,
        });
      },

      addMessage: (conversationId: string, message: Omit<ChatMessage, "id" | "timestamp">, turnId?: string, messageId?: string) => {
        const msgId = messageId || generateId();

        // Generate turnId for user messages, use provided turnId for assistant messages
        let messageTurnId = turnId;
        if (message.role === "user" && !turnId) {
          messageTurnId = generateId();
        }

        const newMessage: ChatMessage = {
          ...message,
          id: msgId,
          timestamp: new Date(),
          turnId: messageTurnId,
        };

        // Check if this is the first user message and we should auto-generate title
        const state = get();
        const conversation = state.conversations.find((c: Conversation) => c.id === conversationId);
        const isFirstUserMessage = conversation && conversation.messages.length === 0 && message.role === "user";
        const newTitle = isFirstUserMessage
          ? message.content.substring(0, 50).trim() || "New Conversation"
          : undefined;

        set((state: ChatState) => {
          // Update selectedTurnIds when a new user message is added
          const newSelectedTurnIds = new Map(state.selectedTurnIds);
          if (message.role === "user" && messageTurnId) {
            newSelectedTurnIds.set(conversationId, messageTurnId);
            console.log(`[Store] New turn started: ${messageTurnId} for conversation ${conversationId}`);
          }

          return {
            conversations: state.conversations.map((conv: Conversation) =>
              conv.id === conversationId
                ? {
                    ...conv,
                    messages: [...conv.messages, newMessage],
                    updatedAt: new Date(),
                    title: newTitle || conv.title,
                  }
                : conv
            ),
            selectedTurnIds: newSelectedTurnIds,
          };
        });

        // If title was auto-generated, save it to MongoDB
        if (newTitle && newTitle !== "New Conversation") {
          const { updateConversationTitle } = get();
          updateConversationTitle(conversationId, newTitle).catch((error) => {
            console.error('[ChatStore] Failed to save auto-generated title:', error);
          });
        }

        return msgId;
      },

      updateMessage: (conversationId: string, messageId: string, updates: Partial<ChatMessage>) => {
        set((state: ChatState) => ({
          conversations: state.conversations.map((conv: Conversation) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg: ChatMessage) =>
                    msg.id === messageId ? { ...msg, ...updates } : msg
                  ),
                  updatedAt: new Date(),
                }
              : conv
          ),
        }));
      },

      appendToMessage: (conversationId: string, messageId: string, content: string) => {
        set((state: ChatState) => ({
          conversations: state.conversations.map((conv: Conversation) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg: ChatMessage) =>
                    msg.id === messageId
                      ? { ...msg, content: msg.content + content }
                      : msg
                  ),
                }
              : conv
          ),
        }));
      },

      setStreaming: (streaming: boolean) => {
        set({ isStreaming: streaming });
      },

      setConversationStreaming: (conversationId: string, state: StreamingState | null) => {
        set((prev: ChatState) => {
          const newMap = new Map(prev.streamingConversations);
          if (state) {
            newMap.set(conversationId, state);
            // Clear input-required when streaming resumes (user submitted input)
            const newInputRequired = new Set(prev.inputRequiredConversations);
            newInputRequired.delete(conversationId);
            console.log(`[Store] Started streaming for conversation: ${conversationId}`);
            return {
              streamingConversations: newMap,
              isStreaming: true,
              inputRequiredConversations: newInputRequired,
            };
          }
          newMap.delete(conversationId);
          console.log(`[Store] Stopped streaming for conversation: ${conversationId}, remaining: ${newMap.size}`);
          const newIsStreaming = newMap.size > 0;
          console.log(`[Store] Global isStreaming: ${newIsStreaming}`);
          return {
            streamingConversations: newMap,
            isStreaming: newIsStreaming,
          };
        });

        // When streaming completes, mark as unviewed if the user is in a different conversation
        if (!state) {
          const current = get();
          if (current.activeConversationId !== conversationId) {
            const newUnviewed = new Set(current.unviewedConversations);
            newUnviewed.add(conversationId);
            set({ unviewedConversations: newUnviewed });
            console.log(`[Store] Marked conversation as unviewed: ${conversationId.substring(0, 8)}`);
          }
        }
      },

      isConversationStreaming: (conversationId: string) => {
        return get().streamingConversations.has(conversationId);
      },

      cancelConversationRequest: (conversationId: string) => {
        const state = get();
        const streamingState = state.streamingConversations.get(conversationId);
        if (streamingState) {
          // Get conversation to check if it's a Dynamic Agent
          const conv = state.conversations.find((c: Conversation) => c.id === conversationId);
          
          // For Dynamic Agents, send backend cancel request before aborting client
          if (streamingState.streamAdapter) {
            if (conv?.agent_id) {
              console.log(`[ChatStore] Cancelling Dynamic Agent stream: conv=${conversationId.substring(0, 8)}, agent=${conv.agent_id}`);
              // Fire-and-forget backend cancel - the abort below will close the client connection
              streamingState.streamAdapter.cancelStream(conversationId, conv.agent_id)
                .then((cancelled) => {
                  console.log(`[ChatStore] Backend cancel result: cancelled=${cancelled}`);
                })
                .catch((error) => {
                  console.error('[ChatStore] Backend cancel failed:', error);
                });
            } else {
              console.warn(`[ChatStore] Cannot cancel backend stream: agent_id not found for conv=${conversationId.substring(0, 8)}`);
            }
          }

          // Abort the client (A2A or Dynamic Agent wrapper)
          streamingState.client.abort();
          // Remove from streaming map
          const newMap = new Map(state.streamingConversations);
          newMap.delete(conversationId);
          set({
            streamingConversations: newMap,
            isStreaming: newMap.size > 0,
          });
          // Mark the message as cancelled with interrupted status
          const msg = conv?.messages.find((m: ChatMessage) => m.id === streamingState.messageId);
          if (msg && !msg.isFinal) {
            // CRITICAL: Copy conversation-level streamEvents to the message for persistence.
            // During streaming, events are collected at conversation.streamEvents. When we cancel,
            // we must attach them to the message so historical messages render timelines correctly.
            const turnStreamEvents = conv?.streamEvents || [];
            state.appendToMessage(conversationId, streamingState.messageId, "\n\n*Request cancelled*");
            state.updateMessage(conversationId, streamingState.messageId, { 
              isFinal: true,
              turnStatus: "interrupted",
              streamEvents: turnStreamEvents.length > 0 ? turnStreamEvents : undefined,
            });
          }

          // Save cancelled state to MongoDB
          get().saveMessagesToServer(conversationId).catch((err) => {
            console.error('[ChatStore] Failed to save cancelled messages:', err);
          });

        }
      },

      // ═══════════════════════════════════════════════════════════════
      // Stream Events (for Dynamic Agents)
      // ═══════════════════════════════════════════════════════════════

      addStreamEvent: (event: StreamEvent, conversationId?: string) => {
        const convId = conversationId || get().activeConversationId;
        if (!convId) return;

        set((prev: ChatState) => {
          return {
            conversations: prev.conversations.map((c: Conversation) =>
              c.id === convId
                ? {
                    ...c,
                    streamEvents: [...(c.streamEvents || []), event],
                  }
                : c
            ),
          };
        });
      },

      clearStreamEvents: (conversationId?: string) => {
        if (conversationId) {
          set((prev: ChatState) => ({
            conversations: prev.conversations.map((conv: Conversation) =>
              conv.id === conversationId
                ? {
                    ...conv,
                    streamEvents: [],
                  }
                : conv
            ),
          }));
        }
      },

      getConversationStreamEvents: (conversationId: string) => {
        const conv = get().conversations.find((c: Conversation) => c.id === conversationId);
        return conv?.streamEvents || [];
      },

      deleteConversation: async (id: string) => {
        const storageMode = await getStorageMode();

        // Delete from local state first (instant UI update)
        set((state: ChatState) => {
          const wasActiveConversation = state.activeConversationId === id;

          // Find the index of the conversation being deleted
          const deletedIndex = state.conversations.findIndex((c: Conversation) => c.id === id);
          const newConversations = state.conversations.filter((c: Conversation) => c.id !== id);

          // If this was the active conversation, select the next one intelligently
          let newActiveId = state.activeConversationId;
          if (wasActiveConversation) {
            if (newConversations.length === 0) {
              // No conversations left
              newActiveId = null;
            } else if (deletedIndex >= newConversations.length) {
              // Was last in list, select the new last one (previous conversation)
              newActiveId = newConversations[newConversations.length - 1].id;
            } else {
              // Select the conversation that took the deleted one's place (next in list)
              newActiveId = newConversations[deletedIndex].id;
            }
          }

          return {
            conversations: newConversations,
            activeConversationId: newActiveId,
          };
        });

        // In MongoDB mode, also delete from server
        if (storageMode === 'mongodb') {
          try {
            await apiClient.deleteConversation(id);
            console.log('[ChatStore] Deleted conversation from MongoDB:', id);
          } catch (error: any) {
            // 404 is expected for conversations that were never saved to MongoDB
            if (error?.message?.includes('404') || error?.message?.includes('not found')) {
              console.log('[ChatStore] Conversation not in MongoDB (expected for new conversations):', id);
            } else {
              console.error('[ChatStore] Failed to delete from MongoDB:', error);
            }
          }
        }
      },

      clearAllConversations: () => {
        set({
          conversations: [],
          activeConversationId: null,
        });
      },

      getActiveConversation: () => {
        const state = get();
        return state.conversations.find((c: Conversation) => c.id === state.activeConversationId);
      },

      updateMessageFeedback: (conversationId: string, messageId: string, feedback: MessageFeedback) => {
        set((state: ChatState) => ({
          conversations: state.conversations.map((conv: Conversation) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg: ChatMessage) =>
                    msg.id === messageId ? { ...msg, feedback } : msg
                  ),
                  updatedAt: new Date(),
                }
              : conv
          ),
        }));
      },

      updateConversationSharing: (conversationId: string, sharing: Conversation['sharing']) => {
        set((state: ChatState) => ({
          conversations: state.conversations.map((conv: Conversation) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  sharing,
                  updatedAt: new Date(),
                }
              : conv
          ),
        }));
        console.log('[ChatStore] Updated conversation sharing:', conversationId, sharing);
      },

      updateConversationTitle: async (conversationId: string, title: string) => {
        const storageMode = await getStorageMode();

        // Update local state immediately (optimistic update)
        set((state: ChatState) => ({
          conversations: state.conversations.map((conv: Conversation) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  title,
                  updatedAt: new Date(),
                }
              : conv
          ),
        }));

        // In MongoDB mode, also update on server
        if (storageMode === 'mongodb') {
          try {
            await apiClient.updateConversation(conversationId, { title });
            console.log('[ChatStore] Updated conversation title in MongoDB:', conversationId, title);
          } catch (error) {
            console.error('[ChatStore] Failed to update conversation title in MongoDB:', error);
            // Revert optimistic update on error
            set((state) => ({
              conversations: state.conversations.map((conv) =>
                conv.id === conversationId
                  ? {
                      ...conv,
                      title: state.conversations.find(c => c.id === conversationId)?.title || "New Conversation",
                    }
                  : conv
              ),
            }));
          }
        }
      },

      setPendingMessage: (message) => {
        set({ pendingMessage: message });
      },

      consumePendingMessage: () => {
        const state = get();
        const message = state.pendingMessage;
        if (message) {
          set({ pendingMessage: null });
        }
        return message;
      },

      loadConversationsFromServer: async () => {
        const storageMode = getStorageMode();

        // Only load from server in MongoDB mode
        if (storageMode !== 'mongodb') {
          console.log('[ChatStore] localStorage mode - no server sync needed');
          return;
        }

        // Prevent multiple simultaneous loads
        if (isLoadingConversations) {
          console.log('[ChatStore] Already loading conversations, skipping...');
          return;
        }

        isLoadingConversations = true;

        try {
          console.log('[ChatStore] Loading conversations from MongoDB...');
          let response;
          try {
            response = await apiClient.getConversations({ page_size: 100 });
          } catch (apiError) {
            // Check if it's an auth error (expected when not logged in)
            const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
            if (errorMessage.includes('Unauthorized') || errorMessage.includes('401')) {
              console.log('[ChatStore] User not authenticated - using local storage only');
            } else {
              console.error('[ChatStore] API call failed:', {
                error: apiError,
                errorMessage,
                errorStack: apiError instanceof Error ? apiError.stack : undefined
              });
            }
            // Don't clear conversations on API error - preserve what we have
            return;
          }

          console.log('[ChatStore] API Response:', {
            responseType: typeof response,
            responseIsNull: response === null,
            responseIsUndefined: response === undefined,
            responseIsEmpty: response && Object.keys(response).length === 0,
            hasItems: !!response?.items,
            itemsLength: response?.items?.length,
            total: response?.total,
            page: response?.page,
            pageSize: response?.page_size,
            hasMore: response?.has_more,
            keys: response ? Object.keys(response) : [],
            fullResponse: JSON.stringify(response).substring(0, 500)
          });

          // Validate response structure
          // API client extracts data, so response is PaginatedResponse: { items: [...], total, page, page_size, has_more }
          if (!response || (typeof response === 'object' && Object.keys(response).length === 0)) {
            console.error('[ChatStore] No response or empty response from MongoDB API');
            // Don't clear conversations - preserve what we have
            return;
          }

          if (!response.items || !Array.isArray(response.items)) {
            console.error('[ChatStore] Invalid response structure from MongoDB API:', {
              response,
              responseType: typeof response,
              hasItems: !!response?.items,
              isArray: Array.isArray(response?.items),
              keys: response ? Object.keys(response) : [],
              stringified: JSON.stringify(response).substring(0, 500)
            });
            // Don't clear existing conversations on invalid response
            return;
          }

          const serverItems = response.items;
          console.log(`[ChatStore] Received ${serverItems.length} conversations from server (total: ${response.total})`);

          // MongoDB is the sole source of truth for the conversation list.
          // Messages start empty — loadMessagesFromServer fills them when the
          // conversation is opened. Only preserve local-only conversations that
          // are actively streaming (just created, server hasn't caught up).
          const currentState = get();

          // Convert server items to local Conversation format
          const serverConversations: Conversation[] = serverItems.map((conv) => {
            // Preserve in-memory messages and events when:
            // 1. The conversation is actively streaming (live stream buffer), OR
            // 2. The conversation already has messages loaded in memory (avoid
            //    discarding data that loadMessagesFromServer already fetched —
            //    otherwise switching tabs wipes the active conversation's content
            //    and the cooldown prevents an immediate re-fetch).
            const isStreaming = currentState.streamingConversations.has(conv._id);
            const isActive = currentState.activeConversationId === conv._id;
            const localConv = currentState.conversations.find(c => c.id === conv._id);
            const hasLoadedMessages = localConv && localConv.messages.length > 0;

            const title = (conv.title && conv.title.trim())
              ? conv.title
              : "New Conversation";

            return {
              id: conv._id,
              title,
              createdAt: new Date(conv.created_at),
              updatedAt: new Date(conv.updated_at),
              // Preserve messages/events when streaming, already loaded, or actively
              // being viewed (prevents race with concurrent loadMessagesFromServer)
              messages: (isStreaming || hasLoadedMessages || isActive) && localConv ? localConv.messages : [],
              streamEvents: (isStreaming || hasLoadedMessages || isActive) && localConv
                ? (localConv.streamEvents || [])
                : [],
              agent_id: conv.agent_id, // Dynamic agent ID; undefined = Platform Engineer
              owner_id: conv.owner_id,
              sharing: conv.sharing,
            };
          });

          // Keep local-only conversations that should not be discarded:
          // 1. Actively streaming (just created, server hasn't caught up)
          // 2. Currently active (e.g. audit/shared conversations that belong
          //    to another user and won't appear in the current user's server
          //    response). No message-count check — preserving regardless of
          //    whether messages have loaded yet eliminates a race condition
          //    where the refresh fires before loadMessagesFromServer completes.
          const serverIds = new Set(serverConversations.map(c => c.id));
          const localOnlyPreserved = currentState.conversations.filter(
            conv => !serverIds.has(conv.id) && (
              currentState.streamingConversations.has(conv.id) ||
              conv.id === currentState.activeConversationId
            )
          );

          if (localOnlyPreserved.length > 0) {
            console.log(`[ChatStore] Keeping ${localOnlyPreserved.length} local-only conversations (streaming or active audit/shared)`);
          }

          const allConversations = [...serverConversations, ...localOnlyPreserved];
          const sortedConversations = allConversations.sort(
            (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
          );

          // Check if active conversation was deleted on another device
          const activeId = currentState.activeConversationId;
          const activeStillExists = activeId ? sortedConversations.some(c => c.id === activeId) : true;

          set({
            conversations: sortedConversations,
            ...(activeId && !activeStillExists ? {
              activeConversationId: sortedConversations.length > 0 ? sortedConversations[0].id : null,
            } : {}),
          });

          if (activeId && !activeStillExists) {
            console.log(`[ChatStore] Active conversation ${activeId.substring(0, 8)} was deleted on another device, switching to first conversation`);
          }

          console.log(`[ChatStore] Loaded ${serverConversations.length} conversations from MongoDB (${localOnlyPreserved.length} local-only preserved)`);
        } catch (error) {
          console.error('[ChatStore] Failed to load conversations from MongoDB:', error);
          console.error('[ChatStore] Error details:', {
            error,
            errorMessage: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined
          });
          // Don't clear conversations on error - preserve what we have
        } finally {
          isLoadingConversations = false;
        }
      },

      // ═══════════════════════════════════════════════════════════════
      // LEVEL 2: Task recovery — poll tasks/get for interrupted messages
      // When a tab crashes or reloads mid-stream, the backend task may still
      // be running (or may have completed). This action checks the task status
      // and recovers the final result if available.
      // ═══════════════════════════════════════════════════════════════
      recoverInterruptedTask: async (conversationId: string, messageId: string, _endpoint: string, _accessToken?: string): Promise<boolean> => {
        // A2A task polling has been removed. The server persists all stream events,
        // so interrupted messages can be reloaded via loadMessagesFromServer instead.
        // Mark as unrecoverable so the "interrupted" banner clears.
        const state = get();
        const conv = state.conversations.find((c: Conversation) => c.id === conversationId);
        if (!conv) return false;
        const msg = conv.messages.find((m: ChatMessage) => m.id === messageId);
        if (!msg || !msg.isInterrupted) return false;
        console.log(`[ChatStore] recoverInterruptedTask: A2A polling removed — marking message ${messageId} as unrecoverable, user can retry`);
        get().updateMessage(conversationId, messageId, { isInterrupted: false });
        return false;
      },

      // Load messages from MongoDB when opening a conversation.
      // This is called every time a conversation page is navigated to in MongoDB mode.
      // It merges server data (new messages, events) with local state, so it's safe
      // to call multiple times — it won't lose local-only state like feedback.
      //
      // Stream events are loaded from the turns collection (by turn_id) and
      // attached to the corresponding assistant messages for timeline rendering.
      loadMessagesFromServer: async (conversationId: string, options?: { force?: boolean }) => {
        const storageMode = getStorageMode();
        if (storageMode !== 'mongodb') return;

        const loadState = messageLoadState.get(conversationId);
        const force = options?.force ?? false;

        // Prevent concurrent loads for the same conversation
        if (loadState?.inFlight) {
          console.log('[ChatStore] Already loading messages for:', conversationId);
          return;
        }

        // CRITICAL: Skip if a post-streaming save is pending.
        // When streaming ends, the correct final content is in the Zustand store
        // but not yet saved to MongoDB. If we fetch from MongoDB now, we'd
        // overwrite the correct in-memory state with stale intermediate content.
        // Only force=true (manual reload) can bypass this guard.
        if (!force) {
          const savePendingSince = pendingSaveTimestamps.get(conversationId);
          if (savePendingSince) {
            const elapsed = Date.now() - savePendingSince;
            if (elapsed < PENDING_SAVE_GRACE_MS) {
              console.log(`[ChatStore] Skipping load — save pending for ${conversationId.substring(0, 8)} (${elapsed}ms ago, grace ${PENDING_SAVE_GRACE_MS}ms)`);
              return;
            }
            // Grace period expired but flag wasn't cleared (save may have failed silently)
            pendingSaveTimestamps.delete(conversationId);
          }
        }

        // Skip if recently loaded (within cooldown) unless force=true (manual reload)
        if (!force && loadState?.lastLoadedAt) {
          const elapsed = Date.now() - loadState.lastLoadedAt;
          if (elapsed < MESSAGE_LOAD_COOLDOWN_MS) {
            console.log(`[ChatStore] Skipping reload for ${conversationId} (loaded ${elapsed}ms ago, cooldown ${MESSAGE_LOAD_COOLDOWN_MS}ms)`);
            return;
          }
        }

        messageLoadState.set(conversationId, { inFlight: true, lastLoadedAt: loadState?.lastLoadedAt ?? 0 });

        try {
          console.log(`[ChatStore] Loading messages + turns from MongoDB for: ${conversationId}`);

          // Fetch messages and turns in parallel
          const [messagesResponse, turnsResponse] = await Promise.all([
            apiClient.getMessages(conversationId, { page_size: 100 }),
            apiClient.getTurns(conversationId, { client_type: 'ui', page_size: 100 }).catch(() => null),
          ]);

          if (!messagesResponse?.items || messagesResponse.items.length === 0) {
            console.log('[ChatStore] No messages found in MongoDB for:', conversationId);
            return;
          }

          // Build turn_id → stream_events lookup from the turns collection
          const turnEventsMap = new Map<string, StreamEvent[]>();
          if (turnsResponse?.items) {
            for (const turn of turnsResponse.items as any[]) {
              const turnId = turn.turn_id;
              const rawEvents = turn.payload?.stream_events;
              if (turnId && Array.isArray(rawEvents)) {
                const deserialized: StreamEvent[] = rawEvents.map((e: any) => ({
                  ...e,
                  timestamp: new Date(e.timestamp),
                }));
                turnEventsMap.set(turnId, deserialized);
              }
            }
          }

          // Build an ordered list of raw items for look-ahead heuristics.
          const rawItems: any[] = messagesResponse.items;

          // Convert MongoDB messages to ChatMessage format
          const messages: ChatMessage[] = rawItems.map((msg: any, idx: number) => {
            // Look up stream events from turns collection by turn_id
            const turnId = msg.metadata?.turn_id;
            const turnStreamEvents: StreamEvent[] = (turnId && turnEventsMap.get(turnId)) || [];

            // Determine isFinal: prefer explicit metadata value.
            let isFinal = msg.metadata?.is_final != null
              ? Boolean(msg.metadata.is_final)
              : true; // Legacy messages without is_final metadata are assumed complete

            // ── Stale is_final heal ──────────────────────────────────
            if (msg.role === 'assistant' && !isFinal) {
              const hasFollowUp = rawItems.slice(idx + 1).some((m: any) => m.role === 'user');
              if (hasFollowUp) {
                console.log(`[ChatStore] Healing stale is_final=false for assistant message ${msg.message_id || msg._id} (followed by user message)`);
                isFinal = true;
              }
            }

            const isExplicitlyInterrupted = Boolean(msg.metadata?.is_interrupted);
            const chatMsg: ChatMessage = {
              id: msg.message_id || msg._id?.toString() || generateId(),
              role: msg.role as "user" | "assistant",
              content: msg.content,
              timestamp: new Date(msg.created_at),
              streamEvents: turnStreamEvents.length > 0 ? turnStreamEvents : undefined,
              isFinal,
              turnId: msg.metadata?.turn_id,
              turnStatus: msg.metadata?.turn_status as TurnStatus | undefined,
              isInterrupted: isExplicitlyInterrupted || (msg.role === 'assistant' && !isFinal),
              feedback: msg.feedback ? {
                type: msg.feedback.rating === 'positive' ? 'like' : msg.feedback.rating === 'negative' ? 'dislike' : null,
                submitted: true,
              } : undefined,
              senderEmail: msg.sender_email,
              senderName: msg.sender_name,
              senderImage: msg.sender_image,
              timelineSegments: msg.metadata?.timeline_segments?.map((seg: any) => ({
                ...seg,
                timestamp: new Date(seg.timestamp),
              })),
            };

            return chatMsg;
          });

          // Preserve agent events for Dynamic Agents from the last turn.
          const isCurrentlyStreaming = get().streamingConversations.has(conversationId);
          const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
          const lastTurnStreamEvents: StreamEvent[] = lastAssistantMsg?.streamEvents || [];

          console.log(`[ChatStore] loadMessagesFromServer: conv=${conversationId.substring(0, 8)}, msgs=${messages.length}, turns=${turnsResponse?.items?.length ?? 0}, isStreaming=${isCurrentlyStreaming}`);

          if (isCurrentlyStreaming) {
            // Conversation is actively streaming — don't overwrite live state
            console.log(`[ChatStore] loadMessagesFromServer: conversation is streaming — skipping store update`);
          } else {
            // Not streaming — MongoDB is the source of truth.
            set((state: ChatState) => {
              const existingConv = state.conversations.find((c: Conversation) => c.id === conversationId);
              const localMsgMap = new Map<string, ChatMessage>();
              if (existingConv) {
                for (const m of existingConv.messages) {
                  localMsgMap.set(m.id, m);
                }
              }

              const mergedMessages = messages.map((serverMsg: ChatMessage) => {
                const localMsg = localMsgMap.get(serverMsg.id);
                if (localMsg?.isFinal && !serverMsg.isFinal) {
                  return localMsg;
                }
                return serverMsg;
              });

              return {
                conversations: state.conversations.map((c: Conversation) =>
                  c.id === conversationId
                    ? {
                        ...c,
                        messages: mergedMessages,
                        streamEvents: lastTurnStreamEvents,
                      }
                    : c
                ),
              };
            });

            console.log(`[ChatStore] Loaded ${messages.length} messages from MongoDB for: ${conversationId}`);
          }

        } catch (error: any) {
          if (error?.message?.includes('401') || error?.message?.includes('Unauthorized')) {
            console.log('[ChatStore] Not authenticated, skipping message load');
          } else if (error?.message?.includes('404')) {
            console.log('[ChatStore] Conversation not found in MongoDB (normal for new conversations)');
          } else {
            console.error('[ChatStore] Failed to load messages from MongoDB:', error);
          }
        } finally {
          messageLoadState.set(conversationId, { inFlight: false, lastLoadedAt: Date.now() });
        }
      },

      // ═══════════════════════════════════════════════════════════════
      // Save messages + turns to MongoDB (idempotent).
      //
      // Messages are upserted to the messages collection (no stream_events).
      // Stream events are written to the turns collection as opaque payloads,
      // keyed by (conversation_id, client_type, turn_id). This decouples
      // per-turn timeline data from message documents.
      //
      // collapseStreamEvents merges per-token content events into one per
      // namespace boundary (~95% reduction) while preserving the interleaved
      // content↔tool ordering needed for timeline rendering.
      // ═══════════════════════════════════════════════════════════════
      saveMessagesToServer: async (conversationId: string) => {
        const storageMode = getStorageMode();
        if (storageMode !== 'mongodb') return;

        // Mark save as pending so loadMessagesFromServer doesn't race with us
        pendingSaveTimestamps.set(conversationId, Date.now());

        const state = get();
        const conv = state.conversations.find((c: Conversation) => c.id === conversationId);
        if (!conv || conv.messages.length === 0) {
          pendingSaveTimestamps.delete(conversationId);
          return;
        }

        // ── 1. Save messages (no stream_events) ─────────────────────
        let savedMsgCount = 0;
        for (const msg of conv.messages) {
          try {
            await apiClient.addMessage(conversationId, {
              message_id: msg.id,
              role: msg.role,
              content: msg.content,
              ...(msg.senderEmail && { sender_email: msg.senderEmail }),
              ...(msg.senderName && { sender_name: msg.senderName }),
              ...(msg.senderImage && { sender_image: msg.senderImage }),
              metadata: {
                turn_id: msg.turnId || `turn-${Date.now()}`,
                is_final: msg.isFinal ?? false,
                ...(msg.turnStatus && { turn_status: msg.turnStatus }),
                ...(msg.isInterrupted && { is_interrupted: msg.isInterrupted }),
              },
              // stream_events intentionally omitted — stored in turns collection
            });
            savedMsgCount++;
          } catch (error: any) {
            console.error(`[ChatStore] Failed to save message ${msg.id.substring(0, 8)}:`, error?.message);
          }
        }

        // ── 2. Save turn documents (stream_events in payload) ───────
        // Determine which turn_id carries the stream events.
        // During streaming, events accumulate at conversation.streamEvents.
        // After finalization, they're copied to the last assistant message's streamEvents.
        // We collapse and write them to a turn document.
        const convStreamEvents = conv.streamEvents || [];
        const lastAssistantMsg = (() => {
          for (let i = conv.messages.length - 1; i >= 0; i--) {
            if (conv.messages[i].role === 'assistant') return conv.messages[i];
          }
          return null;
        })();

        // Collect all unique turn payloads to save
        const turnPayloads = new Map<string, Record<string, unknown>>();

        // Active turn: conversation-level streamEvents → last assistant message's turn
        if (lastAssistantMsg && convStreamEvents.length > 0) {
          const turnId = lastAssistantMsg.turnId || `turn-${Date.now()}`;
          const collapsed = collapseStreamEvents(convStreamEvents);
          if (collapsed.length > 0) {
            turnPayloads.set(turnId, {
              stream_events: collapsed.map(serializeStreamEvent),
              assistant_msg_id: lastAssistantMsg.id,
              turn_status: lastAssistantMsg.turnStatus || 'done',
            });
          }
        }

        // Historical turns: messages that already have per-message streamEvents
        // (from previous saves or restored from server)
        for (const msg of conv.messages) {
          if (msg.role !== 'assistant' || !msg.streamEvents?.length) continue;
          const turnId = msg.turnId;
          if (!turnId || turnPayloads.has(turnId)) continue; // skip if already handled above

          const collapsed = collapseStreamEvents(msg.streamEvents);
          if (collapsed.length > 0) {
            turnPayloads.set(turnId, {
              stream_events: collapsed.map(serializeStreamEvent),
              assistant_msg_id: msg.id,
              turn_status: msg.turnStatus || 'done',
            });
          }
        }

        let savedTurnCount = 0;
        for (const [turnId, payload] of turnPayloads) {
          try {
            await apiClient.upsertTurn(conversationId, {
              turn_id: turnId,
              client_type: 'ui',
              payload,
            });
            savedTurnCount++;
          } catch (error: any) {
            console.error(`[ChatStore] Failed to save turn ${turnId.substring(0, 8)}:`, error?.message);
          }
        }

        pendingSaveTimestamps.delete(conversationId);
        console.log(`[ChatStore] saveMessagesToServer: conv=${conversationId.substring(0, 8)}, msgs=${savedMsgCount}/${conv.messages.length}, turns=${savedTurnCount}/${turnPayloads.size}`);
      },

      // ═══════════════════════════════════════════════════════════════
      // loadTurnsFromServer — NO-OP STUB.
      //
      // This previously fetched Turn[] + StreamEvent[] from the
      // Supervisor A2A proxy routes and mapped them into ChatMessage[].
      // It has been replaced by the unified loadMessagesFromServer
      // which now reads from the turns collection directly.
      //
      // Supervisor conversation loading will be restored in Phase 4.
      // The stub is kept so existing callers (ChatContainer, Sidebar,
      // ChatPanel) compile without changes.
      // ═══════════════════════════════════════════════════════════════
      loadTurnsFromServer: async (_conversationId: string) => {
        // No-op — supervisor path will be restored in Phase 4
      },

      // Evict content from old messages to free memory.
      // Replaces content with a short preview and clears rawStreamContent + events.
      // The full content can be re-loaded from MongoDB via loadMessagesFromServer.
      evictOldMessageContent: (conversationId: string, messageIdsToEvict: string[]) => {
        if (messageIdsToEvict.length === 0) return;
        const evictSet = new Set(messageIdsToEvict);
        let evictedCount = 0;
        let freedChars = 0;

        set((state: ChatState) => ({
          conversations: state.conversations.map((c: Conversation) => {
            if (c.id !== conversationId) return c;
            return {
              ...c,
              messages: c.messages.map((msg: ChatMessage) => {
                if (!evictSet.has(msg.id)) return msg;
                // Keep a short preview for the collapsed banner, evict the rest
                const preview = msg.content.slice(0, 80);
                freedChars += (msg.content?.length || 0) + (msg.rawStreamContent?.length || 0);
                evictedCount++;
                return {
                  ...msg,
                  content: preview,
                  rawStreamContent: undefined,
                  events: [], // Clear events too — they're in MongoDB
                };
              }),
            };
          }),
        }));

        console.log(`[ChatStore] Evicted content from ${evictedCount} messages (~${(freedChars / 1024).toFixed(0)}KB freed) for: ${conversationId.substring(0, 8)}`);
      },

      // ═══════════════════════════════════════════════════════════════
      // AG-UI streaming for Platform Engineer conversations.
      // Uses the /api/chat/stream proxy route via @ag-ui/client HttpAgent.
      // ═══════════════════════════════════════════════════════════════
      sendMessage: async ({
        message,
        conversationId: providedConvId = undefined,
        endpoint = "/api/chat/stream",
        accessToken = undefined,
        userEmail = undefined,
        userName = undefined,
        userImage = undefined,
      }) => {
        const state = get();

        // Resolve or create the conversation
        let convId = providedConvId || state.activeConversationId;
        if (!convId) {
          convId = state.createConversation();
        }

        // Generate a shared turn ID linking the user message to its response
        const turnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

        // Add user message
        state.addMessage(
          convId,
          {
            role: "user",
            content: message,
            senderEmail: userEmail,
            senderName: userName,
            senderImage: userImage,
          },
          turnId
        );

        // Add assistant message placeholder
        const assistantMsgId = state.addMessage(convId, { role: "assistant", content: "" }, turnId);

        let accumulatedText = "";
        let hasReceivedDone = false;
        let eventCount = 0;
        let timelineTextOffset: number | undefined; // char offset where first tool/plan appeared
        let sawWriteTodos = false; // track if write_todos was called this turn
        const timeline = new TimelineManager();

        const conv = get().conversations.find((c: Conversation) => c.id === convId);
        const isDynamicAgent = !!conv?.agent_id;
        if (isDynamicAgent) {
          console.warn("[ChatStore] sendMessage called for a Dynamic Agent conversation — use the Dynamic Agent client instead");
        }

        console.log(`[AG-UI] Starting stream for conv=${convId?.substring(0, 8)}, msg=${assistantMsgId.substring(0, 8)}`);

        // Start the AG-UI stream — returns the abortable client synchronously
        const { abortableClient, streamPromise } = streamAGUIEvents({
          endpoint,
          accessToken,
          convId: convId!,
          assistantMsgId,
          turnId,
          message,

          onTextDelta: (delta: string) => {
            eventCount++;
            accumulatedText += delta;
            get().appendToMessage(convId!, assistantMsgId, delta);
            // When a plan exists, route text into thinking segments tagged
            // with the active plan step so the timeline nests them properly.
            if (timeline.getHasPlan()) {
              timeline.pushThinking(delta, eventCount);
              get().updateMessage(convId!, assistantMsgId, { timelineSegments: timeline.getSegments() });
            }
          },

          onToolStart: (_toolCallId: string, toolName: string) => {
            eventCount++;
            if (toolName === "write_todos") sawWriteTodos = true;
            if (timelineTextOffset === undefined) {
              timelineTextOffset = accumulatedText.length;
              get().updateMessage(convId!, assistantMsgId, { timelineTextOffset });
            }
            timeline.pushToolStart(
              { agent: toolName, tool: toolName, planStepId: timeline.getCurrentPlanStepId() || undefined },
              eventCount,
            );
            get().updateMessage(convId!, assistantMsgId, { timelineSegments: timeline.getSegments() });
          },

          onToolEnd: (_toolCallId: string, toolName: string) => {
            eventCount++;
            timeline.completeToolByName(toolName);
            get().updateMessage(convId!, assistantMsgId, { timelineSegments: timeline.getSegments() });
          },

          onStateDelta: (patch: Array<{ op: string; path: string; value?: any }>) => {
            const stepsOp = patch.find(
              (op) => op.path === "/steps" || op.path === "/plan/steps"
            );
            if (stepsOp && Array.isArray(stepsOp.value)) {
              eventCount++;
              if (timelineTextOffset === undefined) {
                timelineTextOffset = accumulatedText.length;
                get().updateMessage(convId!, assistantMsgId, { timelineTextOffset });
              }
              timeline.pushPlan(stepsOp.value, eventCount);
              get().updateMessage(convId!, assistantMsgId, { timelineSegments: timeline.getSegments() });
            }
          },

          onStateSnapshot: (snapshot: Record<string, unknown>) => {
            // Only process todos from STATE_SNAPSHOT if write_todos was called
            // this turn. The end-of-run snapshot always carries the full state
            // (including todos from previous turns) which would create ghost plans.
            if (!sawWriteTodos) return;
            const todos = snapshot.todos;
            if (Array.isArray(todos) && todos.length > 0) {
              const planSteps = parsePlanStepsFromTodos(todos);
              if (planSteps.length > 0) {
                eventCount++;
                if (timelineTextOffset === undefined) {
                  timelineTextOffset = accumulatedText.length;
                  get().updateMessage(convId!, assistantMsgId, { timelineTextOffset });
                }
                timeline.pushPlan(planSteps, eventCount);
                get().updateMessage(convId!, assistantMsgId, { timelineSegments: timeline.getSegments() });
              }
            }
          },

          onInputRequired: (_payload: InputRequiredPayload) => {
            get().markConversationInputRequired(convId!);
          },

          onDone: () => {
            hasReceivedDone = true;
            const finalSegments = timeline.getSegments();
            get().updateMessage(convId!, assistantMsgId, {
              isFinal: true,
              rawStreamContent: accumulatedText,
              turnId,
              ...(finalSegments.length > 0 ? { timelineSegments: finalSegments } : {}),
            });
            console.log(`[AG-UI] Stream done: turn_id=${turnId}, content=${accumulatedText.length} chars`);
          },

          onError: (errorMessage: string) => {
            console.error("[AG-UI] Stream error:", errorMessage);
            get().appendToMessage(convId!, assistantMsgId, `\n\n**Error:** ${errorMessage}`);
            get().updateMessage(convId!, assistantMsgId, { isFinal: true });
          },
        });

        // Mark conversation as streaming with the AG-UI abortable client
        set((prev: ChatState) => {
          const newMap = new Map(prev.streamingConversations);
          newMap.set(convId!, {
            conversationId: convId!,
            messageId: assistantMsgId,
            client: abortableClient,
          });
          return {
            streamingConversations: newMap,
            isStreaming: true,
          };
        });

        try {
          await streamPromise;
        } catch (error) {
          console.error("[AG-UI] Stream promise rejected:", error);
          get().appendToMessage(convId!, assistantMsgId, `\n\n**Error:** ${(error as Error).message || "Failed to connect to streaming endpoint"}`);
          get().updateMessage(convId!, assistantMsgId, { isFinal: true });
        } finally {
          // Finalize: if no done event received, mark message as final anyway
          if (!hasReceivedDone) {
            const finalSegments = timeline.getSegments();
            get().updateMessage(convId!, assistantMsgId, {
              isFinal: true,
              rawStreamContent: accumulatedText,
              ...(finalSegments.length > 0 ? { timelineSegments: finalSegments } : {}),
            });
          }

          // Clear streaming state
          set((prev: ChatState) => {
            const newMap = new Map(prev.streamingConversations);
            newMap.delete(convId!);
            const isStreaming = newMap.size > 0;

            // Mark as unviewed if the user is looking at a different conversation
            const current = get();
            const newUnviewed = new Set(current.unviewedConversations);
            if (current.activeConversationId !== convId) {
              newUnviewed.add(convId!);
            }

            return {
              streamingConversations: newMap,
              isStreaming,
              unviewedConversations: newUnviewed,
            };
          });

          console.log(`[AG-UI] Stream finished for conv=${convId?.substring(0, 8)}`);
        }
      },

      markConversationUnviewed: (conversationId: string) => {
        set((prev: ChatState) => {
          const newSet = new Set(prev.unviewedConversations);
          newSet.add(conversationId);
          return { unviewedConversations: newSet };
        });
      },

      clearConversationUnviewed: (conversationId: string) => {
        set((prev: ChatState) => {
          const newSet = new Set(prev.unviewedConversations);
          newSet.delete(conversationId);
          return { unviewedConversations: newSet };
        });
      },

      hasUnviewedMessages: (conversationId: string) => {
        return get().unviewedConversations.has(conversationId);
      },

      markConversationInputRequired: (conversationId: string) => {
        set((prev: ChatState) => {
          const newSet = new Set(prev.inputRequiredConversations);
          newSet.add(conversationId);
          return { inputRequiredConversations: newSet };
        });
      },

      clearConversationInputRequired: (conversationId: string) => {
        set((prev: ChatState) => {
          const newSet = new Set(prev.inputRequiredConversations);
          newSet.delete(conversationId);
          return { inputRequiredConversations: newSet };
        });
      },

      isConversationInputRequired: (conversationId: string) => {
        return get().inputRequiredConversations.has(conversationId);
      },

      // Turn selection actions for per-message event tracking
      setSelectedTurn: (conversationId, turnId) => {
        set((state) => {
          const newSelectedTurnIds = new Map(state.selectedTurnIds);
          if (turnId) {
            newSelectedTurnIds.set(conversationId, turnId);
          } else {
            newSelectedTurnIds.delete(conversationId);
          }
          return { selectedTurnIds: newSelectedTurnIds };
        });
      },

      getSelectedTurnId: (conversationId) => {
        const state = get();
        const convId = conversationId || state.activeConversationId;
        if (!convId) return null;
        return state.selectedTurnIds.get(convId) || null;
      },

      isMessageSelectable: () => {
        // Hard lock: no message selection while any conversation is streaming
        const state = get();
        return state.streamingConversations.size === 0;
      },

      getTurnCount: (conversationId) => {
        const state = get();
        const convId = conversationId || state.activeConversationId;
        if (!convId) return 0;

        const conv = state.conversations.find((c) => c.id === convId);
        if (!conv) return 0;

        // Count unique turnIds from user messages
        const turnIds = new Set(
          conv.messages.filter((m) => m.role === "user" && m.turnId).map((m) => m.turnId)
        );
        return turnIds.size;
      },

      getCurrentTurnIndex: (conversationId) => {
        const state = get();
        const convId = conversationId || state.activeConversationId;
        if (!convId) return 0;

        const conv = state.conversations.find((c) => c.id === convId);
        if (!conv) return 0;

        const selectedTurnId = state.selectedTurnIds.get(convId);
        if (!selectedTurnId) return state.getTurnCount(convId);

        // Get ordered list of turnIds
        const turnIds = conv.messages
          .filter((m) => m.role === "user" && m.turnId)
          .map((m) => m.turnId!);

        const index = turnIds.indexOf(selectedTurnId);
        return index === -1 ? turnIds.length : index + 1;
      },
});

// Export store with conditional persistence based on storage mode
export const useChatStore = shouldUseLocalStorage()
  ? // localStorage mode: Enable persistence
    create<ChatState>()(
      persist(storeImplementation, {
        name: "caipe-chat-history",
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          conversations: state.conversations.map((conv) => ({
            ...conv,
            streamEvents: [], // Don't persist stream events (too large)
            messages: conv.messages.map((msg) => ({
              ...msg,
            })),
          })),
          activeConversationId: state.activeConversationId,
          selectedTurnIdsArray: Array.from(state.selectedTurnIds.entries()),
        }),
        onRehydrateStorage: () => (state) => {
          if (state) {
            state.conversations = state.conversations.map((conv) => ({
              ...conv,
              createdAt: new Date(conv.createdAt),
              updatedAt: new Date(conv.updatedAt),
              streamEvents: [],
              messages: conv.messages.map((msg, idx, allMsgs) => {
                // CRASH RECOVERY: Mark non-final assistant messages as interrupted.
                // After a page crash/reload, streamingConversations is empty (not persisted),
                // so any assistant message without isFinal=true was mid-stream when the tab died.
                //
                // HEAL: If a subsequent user message exists, the response actually completed
                // — the original session just didn't persist isFinal=true before crashing.
                let healed = false;
                if (msg.role === 'assistant' && !msg.isFinal) {
                  const hasFollowUp = allMsgs.slice(idx + 1).some(m => m.role === 'user');
                  if (hasFollowUp) healed = true;
                }
                return {
                  ...msg,
                  timestamp: new Date(msg.timestamp),
                  isFinal: healed ? true : msg.isFinal,
                  isInterrupted: healed
                    ? false
                    : (msg.role === 'assistant' && !msg.isFinal ? true : msg.isInterrupted),
                  streamEvents: msg.streamEvents,
                  // Rehydrate Date objects in timeline segments
                  timelineSegments: msg.timelineSegments?.map((seg: any) => ({
                    ...seg,
                    timestamp: new Date(seg.timestamp),
                  })),
                };
              }),
            }));
            const storedArray = (state as unknown as { selectedTurnIdsArray?: [string, string][] }).selectedTurnIdsArray;
            state.selectedTurnIds = new Map(storedArray || []);
          }
        },
      })
    )
  : // MongoDB mode: NO localStorage cache — MongoDB is the sole source of truth.
    // State lives in Zustand's in-memory store only (survives within a session via
    // React re-renders) and is loaded from / saved to MongoDB explicitly.
    // This eliminates the "two sources of truth" drift that caused stale content,
    // phantom "interrupted" banners, and merge conflicts between localStorage and MongoDB.
    create<ChatState>()(storeImplementation);

// ═══════════════════════════════════════════════════════════════
// DEBUG: Expose diagnostic helpers on window for debugging message persistence
// Run in browser console:   __caipeDebug.messages()        — local messages
//                           __caipeDebug.compare()         — local vs MongoDB diff
//                           __caipeDebug.mongo()           — raw MongoDB fetch
//                           __caipeDebug.localStorage()    — raw localStorage data
// ═══════════════════════════════════════════════════════════════
if (typeof window !== 'undefined') {
  (window as any).__caipeDebug = {
    /** Show local messages for the active conversation */
    messages: () => {
      const state = useChatStore.getState();
      const conv = state.conversations.find((c: Conversation) => c.id === state.activeConversationId);
      if (!conv) { console.log('No active conversation'); return; }
      console.log(`Conversation: ${conv.id} (${conv.title || 'untitled'})`);
      console.log(`Messages: ${conv.messages.length}`);
      console.table(conv.messages.map((m: ChatMessage) => ({
        id: m.id?.substring(0, 8),
        role: m.role,
        contentLen: m.content?.length || 0,
        contentPreview: (m.content || '').substring(0, 80),
        isFinal: m.isFinal,
        isInterrupted: m.isInterrupted,
        turnId: m.turnId?.substring(0, 8),
      })));
      return conv.messages;
    },
    /** Fetch messages from MongoDB for the active conversation and compare */
    compare: async () => {
      const state = useChatStore.getState();
      const convId = state.activeConversationId;
      if (!convId) { console.log('No active conversation'); return; }
      const conv = state.conversations.find((c: Conversation) => c.id === convId);
      const localMsgs = conv?.messages || [];

      try {
        const res = await fetch(`/api/chat/conversations/${convId}/messages?pageSize=100`);
        const data = await res.json();
        const mongoMsgs = data.items || data.data || [];

        console.log(`\n=== COMPARISON for ${convId} ===`);
        console.log(`Local: ${localMsgs.length} messages | MongoDB: ${mongoMsgs.length} messages`);

        const maxLen = Math.max(localMsgs.length, mongoMsgs.length);
        const rows: any[] = [];
        for (let i = 0; i < maxLen; i++) {
          const local = localMsgs[i] as ChatMessage | undefined;
          const mongo = mongoMsgs[i] as any | undefined;
          rows.push({
            '#': i,
            localId: local?.id?.substring(0, 8) || '—',
            mongoId: (mongo?.message_id || mongo?._id)?.substring(0, 8) || '—',
            role: local?.role || mongo?.role || '—',
            localContentLen: local?.content?.length || 0,
            mongoContentLen: mongo?.content?.length || 0,
            contentMatch: local && mongo ? (local.content?.length === mongo.content?.length ? '✅' : `❌ Δ${(local.content?.length || 0) - (mongo.content?.length || 0)}`) : '—',
            localIsFinal: local?.isFinal,
            mongoIsFinal: mongo?.metadata?.is_final,
            finalMatch: local && mongo ? (Boolean(local.isFinal) === Boolean(mongo.metadata?.is_final) ? '✅' : '❌') : '—',
            localInterrupted: local?.isInterrupted,
            mongoInterrupted: mongo?.metadata?.is_interrupted,
          });
        }
        console.table(rows);
        return { local: localMsgs, mongo: mongoMsgs, rows };
      } catch (err) {
        console.error('Failed to fetch from MongoDB:', err);
      }
    },
    /** Fetch raw MongoDB messages for active conversation */
    mongo: async () => {
      const convId = useChatStore.getState().activeConversationId;
      if (!convId) { console.log('No active conversation'); return; }
      const res = await fetch(`/api/chat/conversations/${convId}/messages?pageSize=100`);
      const data = await res.json();
      const items = data.items || data.data || [];
      console.log(`MongoDB: ${items.length} messages for ${convId}`);
      console.table(items.map((m: any) => ({
        id: (m.message_id || m._id)?.substring(0, 8),
        role: m.role,
        contentLen: m.content?.length || 0,
        contentPreview: (m.content || '').substring(0, 80),
        is_final: m.metadata?.is_final,
        is_interrupted: m.metadata?.is_interrupted,
        task_id: m.metadata?.task_id?.substring(0, 8),
        events: m.a2a_events?.length || 0,
      })));
      return items;
    },
    /** Show raw localStorage cache data */
    localStorage: () => {
      for (const key of ['caipe-chat-history', 'caipe-chat-history-mongodb-cache']) {
        const raw = window.localStorage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            const convs = parsed?.state?.conversations || [];
            console.log(`\n=== ${key} ===`);
            console.log(`Conversations: ${convs.length}`);
            for (const conv of convs) {
              console.log(`  ${conv.id?.substring(0, 8)}: "${conv.title}" — ${conv.messages?.length || 0} messages`);
              if (conv.messages) {
                console.table(conv.messages.map((m: any) => ({
                  id: m.id?.substring(0, 8),
                  role: m.role,
                  contentLen: m.content?.length || 0,
                  isFinal: m.isFinal,
                  isInterrupted: m.isInterrupted,
                })));
              }
            }
          } catch { console.log(`${key}: parse error`); }
        } else {
          console.log(`${key}: not found`);
        }
      }
    },
    /** Show storage mode info */
    storageMode: () => {
      const mode = getStorageMode();
      console.log(`Storage mode: ${mode}`);
      if (mode === 'mongodb') {
        console.log('MongoDB is sole source of truth — no localStorage cache');
      } else {
        console.log('localStorage mode — data persisted in browser only');
      }
    },
  };
  console.log('[CAIPE] Debug helpers available: __caipeDebug.messages(), __caipeDebug.compare(), __caipeDebug.mongo(), __caipeDebug.localStorage(), __caipeDebug.storageMode()');

  // ── ONE-TIME CLEANUP: Remove stale localStorage cache from MongoDB mode ──
  // Previous versions used localStorage as a cache in MongoDB mode under the key
  // "caipe-chat-history-mongodb-cache". This created two-source-of-truth bugs.
  // Clear it on startup so users don't accidentally load stale cached data.
  if (getStorageMode() === 'mongodb') {
    const staleKey = 'caipe-chat-history-mongodb-cache';
    if (window.localStorage.getItem(staleKey)) {
      console.log(`[ChatStore] Removing stale localStorage cache: ${staleKey}`);
      window.localStorage.removeItem(staleKey);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// UNLOAD HANDLER: No warning needed.
// ═══════════════════════════════════════════════════════════════
// Stream events are persisted to the turns collection on stream
// finalization.  A page refresh reloads from MongoDB via
// loadMessagesFromServer.  There is nothing to warn the user
// about, so the beforeunload prompt has been removed.
