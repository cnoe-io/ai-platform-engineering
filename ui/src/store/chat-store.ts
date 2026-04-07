import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Conversation, ChatMessage, MessageFeedback, TurnStatus } from "@/types/a2a";
import { SSEAgentEvent } from "@/components/dynamic-agents/sse-types";
import { generateId } from "@/lib/utils";
import { DynamicAgentClient } from "@/components/dynamic-agents/da-streaming-client";
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
  // For Dynamic Agents: client reference for backend cancellation
  dynamicAgentClient?: DynamicAgentClient;
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
  // SSE Agent events (for Dynamic Agents)
  addSSEEvent: (event: SSEAgentEvent, conversationId?: string) => void;
  clearSSEEvents: (conversationId?: string) => void;
  getConversationSSEEvents: (conversationId: string) => SSEAgentEvent[];
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
  loadTurnsFromServer: (conversationId: string) => Promise<void>; // Load turns + events from Supervisor A2A and map to ChatMessages
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
          sseEvents: [], // Initialize with empty SSE events for Dynamic Agents
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
          if (streamingState.dynamicAgentClient) {
            if (conv?.agent_id) {
              console.log(`[ChatStore] Cancelling Dynamic Agent stream: conv=${conversationId.substring(0, 8)}, agent=${conv.agent_id}`);
              // Fire-and-forget backend cancel - the abort below will close the client connection
              streamingState.dynamicAgentClient.cancelStream(conversationId, conv.agent_id)
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
            // CRITICAL: Copy conversation-level sseEvents to the message for persistence.
            // During streaming, events are collected at conversation.sseEvents. When we cancel,
            // we must attach them to the message so historical messages render timelines correctly.
            const turnSSEEvents = conv?.sseEvents || [];
            state.appendToMessage(conversationId, streamingState.messageId, "\n\n*Request cancelled*");
            state.updateMessage(conversationId, streamingState.messageId, { 
              isFinal: true,
              turnStatus: "interrupted",
              sseEvents: turnSSEEvents.length > 0 ? turnSSEEvents : undefined,
            });
          }

        }
      },

      // ═══════════════════════════════════════════════════════════════
      // SSE Agent Events (for Dynamic Agents)
      // ═══════════════════════════════════════════════════════════════

      addSSEEvent: (event: SSEAgentEvent, conversationId?: string) => {
        const convId = conversationId || get().activeConversationId;
        if (!convId) return;

        set((prev: ChatState) => {
          return {
            conversations: prev.conversations.map((c: Conversation) =>
              c.id === convId
                ? {
                    ...c,
                    sseEvents: [...(c.sseEvents || []), event],
                  }
                : c
            ),
          };
        });
      },

      clearSSEEvents: (conversationId?: string) => {
        if (conversationId) {
          set((prev: ChatState) => ({
            conversations: prev.conversations.map((conv: Conversation) =>
              conv.id === conversationId
                ? {
                    ...conv,
                    sseEvents: [],
                  }
                : conv
            ),
          }));
        }
      },

      getConversationSSEEvents: (conversationId: string) => {
        const conv = get().conversations.find((c: Conversation) => c.id === conversationId);
        return conv?.sseEvents || [];
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
              sseEvents: (isStreaming || hasLoadedMessages || isActive) && localConv ? (localConv.sseEvents || []) : [],
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
        // so interrupted messages can be reloaded via loadTurnsFromServer instead.
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
          console.log(`[ChatStore] Loading messages from MongoDB for: ${conversationId}`);
          const response = await apiClient.getMessages(conversationId, { page_size: 100 });

          if (!response?.items || response.items.length === 0) {
            console.log('[ChatStore] No messages found in MongoDB for:', conversationId);
            return;
          }

          // Build an ordered list of raw items for look-ahead heuristics.
          // We need to know whether a "not final" assistant message is actually
          // followed by a subsequent user message — if so the response completed
          // successfully but the original session crashed before writing is_final=true.
          const rawItems: any[] = response.items;

          // Convert MongoDB messages to ChatMessage format
          const messages: ChatMessage[] = rawItems.map((msg: any, idx: number) => {
            // Deserialize SSE events (for Dynamic Agents)
            const sseEvents: SSEAgentEvent[] = (msg.sse_events || []).map((e: any) => ({
              ...e,
              timestamp: new Date(e.timestamp),
            }));

            // Determine isFinal: prefer explicit metadata value.
            // We now always save is_final explicitly (false for in-progress, true for complete).
            // For legacy messages that don't have is_final, default to true (they were complete).
            let isFinal = msg.metadata?.is_final != null
              ? Boolean(msg.metadata.is_final)
              : true; // Legacy messages without is_final metadata are assumed complete

            // ── Stale is_final heal ──────────────────────────────────
            // If an assistant message has is_final=false but a subsequent user
            // message exists, the response DID complete — the original page just
            // crashed before persisting is_final=true.  Fix the flag so the
            // "Response was interrupted" banner does not show.
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
              sseEvents: sseEvents.length > 0 ? sseEvents : undefined, // Only set if present
              isFinal,
              turnId: msg.metadata?.turn_id,
              // Restore turnStatus from MongoDB (defaults to undefined for legacy messages)
              turnStatus: msg.metadata?.turn_status as TurnStatus | undefined,
              isInterrupted: isExplicitlyInterrupted || (msg.role === 'assistant' && !isFinal),
              feedback: msg.feedback ? {
                type: msg.feedback.rating === 'positive' ? 'like' : msg.feedback.rating === 'negative' ? 'dislike' : null,
                submitted: true,
              } : undefined,
              // Sender identity — present for messages created after this feature.
              // Legacy messages without these fields will fall back to session-based
              // display in the UI (backward compatible).
              senderEmail: msg.sender_email,
              senderName: msg.sender_name,
              senderImage: msg.sender_image,
              // Restore timeline segments from MongoDB metadata
              timelineSegments: msg.metadata?.timeline_segments?.map((seg: any) => ({
                ...seg,
                timestamp: new Date(seg.timestamp),
              })),
            };

            return chatMsg;
          });

          // Preserve SSE events for Dynamic Agents from the last turn.
          const isCurrentlyStreaming = get().streamingConversations.has(conversationId);
          const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
          const lastTurnSSEEvents: SSEAgentEvent[] = lastAssistantMsg?.sseEvents || [];

          console.log(`[ChatStore] loadMessagesFromServer: conv=${conversationId.substring(0, 8)}, msgs=${messages.length}, isStreaming=${isCurrentlyStreaming}`);

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
                        sseEvents: lastTurnSSEEvents,
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
      // PHASE 3: Load turns + events from the Supervisor A2A server.
      // The A2A server (Phase 1) now persists all streaming data.  This
      // action fetches Turn[] + StreamEvent[] from the proxy routes and
      // maps them into ChatMessage[] so existing UI components continue to
      // work unchanged.  It replaces the MongoDB-backed loadMessagesFromServer
      // for conversations that have server-side turn persistence.
      //
      // STREAM RECOVERY: If the latest turn has assistant_message.status ==
      // "streaming" (the server was still processing when the page refreshed),
      // we immediately render a loading placeholder and then poll
      // GET /api/v1/conversations/{id}/turns/{turn_id} every 2 s until the
      // turn transitions to a terminal state.  On completion we re-fetch the
      // full turn list and replace the placeholder with the real content.
      // ═══════════════════════════════════════════════════════════════
      loadTurnsFromServer: async (conversationId: string) => {
        const storageMode = getStorageMode();
        if (storageMode !== 'mongodb') return;

        // Skip if actively streaming — the live in-memory buffer is authoritative.
        if (get().streamingConversations.has(conversationId)) {
          console.log(`[ChatStore] loadTurnsFromServer: skipping — conversation is streaming: ${conversationId.substring(0, 8)}`);
          return;
        }

        // ---------------------------------------------------------------------------
        // Internal helper: fetch turns + events from the proxy and map to messages.
        // Returns null on non-retryable errors (already logged).
        // ---------------------------------------------------------------------------
        const fetchAndMapTurns = async (): Promise<{
          messages: ChatMessage[];
          turns: any[];
          allEvents: any[];
        } | null> => {
          const [turnsRes, eventsRes] = await Promise.all([
            fetch(`/api/dynamic-agents/conversations/${conversationId}/turns`),
            fetch(`/api/dynamic-agents/conversations/${conversationId}/events`),
          ]);

          if (!turnsRes.ok || !eventsRes.ok) {
            const turnsStatus = turnsRes.status;
            const eventsStatus = eventsRes.status;
            if (turnsStatus === 404 || turnsStatus === 503 || eventsStatus === 404 || eventsStatus === 503) {
              console.log(`[ChatStore] loadTurnsFromServer: server-side turns not available (turns=${turnsStatus}, events=${eventsStatus}) — falling back`);
              return null;
            }
            if (turnsStatus === 401 || eventsStatus === 401) {
              console.log('[ChatStore] loadTurnsFromServer: not authenticated, skipping');
              return null;
            }
            console.error(`[ChatStore] loadTurnsFromServer: unexpected error (turns=${turnsStatus}, events=${eventsStatus})`);
            return null;
          }

          const turnsData = await turnsRes.json();
          const eventsData = await eventsRes.json();

          const turns: any[] = Array.isArray(turnsData) ? turnsData : (turnsData.items ?? []);
          const allEvents: any[] = Array.isArray(eventsData) ? eventsData : (eventsData.items ?? []);

          if (turns.length === 0) {
            return { messages: [], turns, allEvents };
          }

          // Build a map of turn_id → events for O(1) lookup per turn
          const eventsByTurnId = new Map<string, any[]>();
          for (const ev of allEvents) {
            const tid = ev.turn_id ?? ev.turnId;
            if (!tid) continue;
            const bucket = eventsByTurnId.get(tid) ?? [];
            bucket.push(ev);
            eventsByTurnId.set(tid, bucket);
          }

          // Map each Turn into a pair of ChatMessages (user + assistant).
          // Turn shape (from A2A server):
          //   { _id: turn_id, conversation_id, user_message, assistant_message: { status, content, ... }, status, created_at, updated_at }
          // StreamEvent shape:
          //   { event_id, turn_id, conversation_id, event_type, payload, created_at }
          const messages: ChatMessage[] = [];

          for (const turn of turns) {
            // _id is the MongoDB document ID (same as turn_id for TurnPersistence documents)
            const turnId: string = turn._id ?? turn.turn_id ?? turn.id ?? generateId();

            // ── User message ──────────────────────────────────────────
            const userContent: string =
              turn.user_message?.content ??
              turn.user_message?.parts?.map((p: any) => p.text ?? '').join('') ??
              '';

            if (userContent) {
              messages.push({
                id: turn.user_message?.message_id ?? `${turnId}-user`,
                role: 'user',
                content: userContent,
                timestamp: new Date(turn.created_at ?? Date.now()),
                isFinal: true,
                turnId,
                senderEmail: turn.user_message?.sender_email,
                senderName: turn.user_message?.sender_name,
                senderImage: turn.user_message?.sender_image,
              });
            }

            // ── Assistant message ─────────────────────────────────────
            const assistantContent: string =
              turn.assistant_message?.content ??
              turn.assistant_message?.parts?.map((p: any) => p.text ?? '').join('') ??
              '';

            const turnEvents: any[] = eventsByTurnId.get(turnId) ?? [];

            // Reconstruct AG-UI BaseEvent objects from persisted stream_events.
            // Each event has data.agui_type set by PersistedLangGraphAgent.
            const aguiEvents: import("@ag-ui/core").BaseEvent[] = turnEvents
              .filter((e: any) => e.data?.agui_type)
              .map((e: any) => {
                const data = e.data;
                const baseEvent: any = { type: data.agui_type };
                switch (data.agui_type) {
                  case "TEXT_MESSAGE_CONTENT":
                    baseEvent.delta = data.content;
                    break;
                  case "TOOL_CALL_START":
                    baseEvent.toolCallId = data.tool_call_id;
                    baseEvent.toolCallName = data.tool_name;
                    break;
                  case "TOOL_CALL_END":
                    baseEvent.toolCallId = data.tool_call_id;
                    break;
                  case "STATE_DELTA":
                    baseEvent.delta = data.delta;
                    break;
                  case "STATE_SNAPSHOT":
                    baseEvent.snapshot = { todos: data.todos };
                    break;
                  case "CUSTOM":
                    baseEvent.name = data.custom_name;
                    baseEvent.value = data.fields;
                    break;
                }
                return baseEvent as import("@ag-ui/core").BaseEvent;
              });

            // Build timeline from the reconstructed AG-UI events
            const timelineSegments = TimelineManager.buildFromAGUIEvents(aguiEvents);

            // Compute timelineTextOffset: count text chars before first tool/plan event
            let reconstructedOffset: number | undefined;
            let textAccum = 0;
            for (const ev of aguiEvents) {
              if ((ev as any).type === "TEXT_MESSAGE_CONTENT") {
                textAccum += ((ev as any).delta ?? "").length;
              } else if (
                (ev as any).type === "TOOL_CALL_START" ||
                (ev as any).type === "STATE_DELTA" ||
                (ev as any).type === "STATE_SNAPSHOT"
              ) {
                reconstructedOffset = textAccum;
                break;
              }
            }

            // assistant_message.status is set by TurnPersistence: "streaming" while
            // in-flight, then "completed" / "interrupted" / "failed" at the end.
            // Fall back to the top-level turn.status for older documents that don't
            // have the nested field.
            const assistantMsgStatus: string =
              turn.assistant_message?.status ?? turn.status ?? '';
            const isServerStreaming = assistantMsgStatus === 'streaming';
            const isFinal =
              !isServerStreaming &&
              (assistantMsgStatus === 'completed' || assistantMsgStatus === 'done' ||
               turn.status === 'completed' || turn.status === 'done');
            const isInterrupted =
              !isServerStreaming &&
              (assistantMsgStatus === 'interrupted' || assistantMsgStatus === 'failed' ||
               turn.status === 'interrupted' || turn.status === 'failed');

            // Emit an assistant message whenever there is content, events, or the
            // turn is still in-flight (so the loading indicator renders on refresh).
            if (assistantContent || aguiEvents.length > 0 || isServerStreaming) {
              messages.push({
                id: turn.assistant_message?.message_id ?? `${turnId}-assistant`,
                role: 'assistant',
                content: assistantContent,
                timestamp: new Date(turn.updated_at ?? turn.created_at ?? Date.now()),
                isFinal,
                isInterrupted,
                turnId,
                turnStatus: isFinal ? 'done' : isInterrupted ? 'interrupted' : undefined,
                timelineSegments: timelineSegments.length > 0 ? timelineSegments : undefined,
                timelineTextOffset: reconstructedOffset,
              });
            }
          }

          return { messages, turns, allEvents };
        };

        // ---------------------------------------------------------------------------
        // Internal helper: commit a ChatMessage[] array to the Zustand store.
        // ---------------------------------------------------------------------------
        const commitMessages = (messages: ChatMessage[]) => {
          set((state: ChatState) => ({
            conversations: state.conversations.map((c: Conversation) =>
              c.id === conversationId
                ? {
                    ...c,
                    messages,
                    sseEvents: [],
                  }
                : c
            ),
          }));
        };

        try {
          console.log(`[ChatStore] loadTurnsFromServer: fetching turns for ${conversationId.substring(0, 8)}`);

          const result = await fetchAndMapTurns();
          if (!result) return; // Non-retryable error — already logged

          const { messages, turns, allEvents } = result;

          if (messages.length === 0) {
            console.log(`[ChatStore] loadTurnsFromServer: no turns found for ${conversationId.substring(0, 8)}`);
            return;
          }

          // Commit initial messages (may include a streaming placeholder with isFinal=false)
          commitMessages(messages);
          console.log(`[ChatStore] loadTurnsFromServer: loaded ${messages.length} messages (${turns.length} turns, ${allEvents.length} events) for: ${conversationId.substring(0, 8)}`);

          // ── Stream recovery: poll until the latest turn reaches a terminal state ──
          const lastTurn = turns[turns.length - 1];
          const lastAssistantStatus: string =
            lastTurn?.assistant_message?.status ?? lastTurn?.status ?? '';

          if (lastAssistantStatus !== 'streaming') return; // Nothing to recover

          const lastTurnId: string = lastTurn?._id ?? lastTurn?.turn_id ?? lastTurn?.id ?? '';
          if (!lastTurnId) {
            console.warn('[ChatStore] loadTurnsFromServer: cannot poll — last turn has no ID');
            return;
          }

          console.log(`[ChatStore] loadTurnsFromServer: turn ${lastTurnId.substring(0, 8)} is streaming — starting recovery poll`);

          const POLL_INTERVAL_MS = 2000;
          const MAX_POLL_ATTEMPTS = 150; // 5 minutes maximum
          let attempts = 0;

          const poll = async (): Promise<void> => {
            // Cancel if the user started a fresh live stream
            if (get().streamingConversations.has(conversationId)) {
              console.log('[ChatStore] loadTurnsFromServer: poll cancelled — conversation started live streaming');
              return;
            }

            if (attempts >= MAX_POLL_ATTEMPTS) {
              console.warn(`[ChatStore] loadTurnsFromServer: poll timed out after ${MAX_POLL_ATTEMPTS} attempts for turn ${lastTurnId.substring(0, 8)}`);
              // Mark the placeholder as interrupted so the retry banner renders
              set((state: ChatState) => ({
                conversations: state.conversations.map((c: Conversation) =>
                  c.id === conversationId
                    ? {
                        ...c,
                        messages: c.messages.map((m: ChatMessage) =>
                          m.turnId === lastTurnId && m.role === 'assistant' && !m.isFinal
                            ? { ...m, isFinal: true, isInterrupted: true }
                            : m
                        ),
                      }
                    : c
                ),
              }));
              return;
            }

            attempts++;

            await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

            // Recheck after the wait
            if (get().streamingConversations.has(conversationId)) {
              console.log('[ChatStore] loadTurnsFromServer: poll cancelled — conversation started live streaming');
              return;
            }

            try {
              const turnRes = await fetch(
                `/api/dynamic-agents/conversations/${conversationId}/turns/${lastTurnId}`
              );

              if (!turnRes.ok) {
                if (turnRes.status === 401) {
                  console.log('[ChatStore] loadTurnsFromServer: poll not authenticated, stopping');
                  return;
                }
                // Transient error — keep polling
                console.warn(`[ChatStore] loadTurnsFromServer: poll got ${turnRes.status}, retrying (attempt ${attempts})`);
                return poll();
              }

              const turnDoc = await turnRes.json();
              const polledStatus: string =
                turnDoc?.assistant_message?.status ?? turnDoc?.status ?? '';
              console.log(`[ChatStore] loadTurnsFromServer: poll ${attempts} — turn status: ${polledStatus}`);

              if (polledStatus === 'streaming') {
                // Update the placeholder with any content the server has buffered so far
                const bufferedContent: string = turnDoc?.assistant_message?.content ?? '';
                if (bufferedContent) {
                  set((state: ChatState) => ({
                    conversations: state.conversations.map((c: Conversation) =>
                      c.id === conversationId
                        ? {
                            ...c,
                            messages: c.messages.map((m: ChatMessage) =>
                              m.turnId === lastTurnId && m.role === 'assistant' && !m.isFinal
                                ? { ...m, content: bufferedContent }
                                : m
                            ),
                          }
                        : c
                    ),
                  }));
                }
                return poll();
              }

              // Terminal state reached — reload the full turn list
              console.log(`[ChatStore] loadTurnsFromServer: turn ${lastTurnId.substring(0, 8)} completed (status=${polledStatus}) — reloading turns`);
              const freshResult = await fetchAndMapTurns();
              if (freshResult && freshResult.messages.length > 0) {
                commitMessages(freshResult.messages);
                console.log(`[ChatStore] loadTurnsFromServer: recovery complete — ${freshResult.messages.length} messages loaded`);
              }
            } catch (pollError: any) {
              console.warn('[ChatStore] loadTurnsFromServer: poll error, retrying:', pollError?.message);
              return poll();
            }
          };

          // Fire and forget — the caller awaits the initial load, recovery runs in background
          poll().catch((err) => {
            console.error('[ChatStore] loadTurnsFromServer: unexpected poll failure:', err);
          });

        } catch (error: any) {
          if (error?.message?.includes('401') || error?.message?.includes('Unauthorized')) {
            console.log('[ChatStore] loadTurnsFromServer: not authenticated, skipping');
          } else {
            console.error('[ChatStore] loadTurnsFromServer failed:', error);
          }
        }
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
            // AG-UI: Text streams directly to message.content as markdown.
            // Timeline only shows tool/plan segments, not text.
          },

          onToolStart: (_toolCallId: string, toolName: string) => {
            eventCount++;
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
            sseEvents: [], // Don't persist SSE events (too large)
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
              sseEvents: [],
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
// The server-side TurnPersistence layer saves every streaming event and
// the final content to MongoDB in real-time.  A page refresh no longer
// loses data — loadTurnsFromServer will detect the in-progress turn on
// reload and poll until the server finishes.  There is nothing to warn
// the user about, so the beforeunload prompt has been removed.
