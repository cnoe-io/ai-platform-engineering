import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Conversation, ChatMessage, A2AEvent, MessageFeedback } from "@/types/a2a";
import { generateId } from "@/lib/utils";
import { A2AClient } from "@/lib/a2a-client";
import { apiClient } from "@/lib/api-client";
import { getStorageMode, shouldUseLocalStorage } from "@/lib/storage-config";

// Track streaming state per conversation
interface StreamingState {
  conversationId: string;
  messageId: string;
  client: A2AClient;
}

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  isStreaming: boolean;
  streamingConversations: Map<string, StreamingState>;
  a2aEvents: A2AEvent[];
  pendingMessage: string | null; // Message to auto-submit when ChatPanel mounts

  // Per-turn event tracking: selectedTurnId per conversation
  selectedTurnIds: Map<string, string>; // conversationId -> turnId

  // Actions
  createConversation: () => string;
  setActiveConversation: (id: string) => void;
  addMessage: (conversationId: string, message: Omit<ChatMessage, "id" | "timestamp" | "events">, turnId?: string) => string;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  appendToMessage: (conversationId: string, messageId: string, content: string) => void;
  addEventToMessage: (conversationId: string, messageId: string, event: A2AEvent) => void;
  setStreaming: (streaming: boolean) => void;
  setConversationStreaming: (conversationId: string, state: StreamingState | null) => void;
  isConversationStreaming: (conversationId: string) => boolean;
  cancelConversationRequest: (conversationId: string) => void;
  addA2AEvent: (event: A2AEvent, conversationId?: string) => void;
  clearA2AEvents: (conversationId?: string) => void;
  getConversationEvents: (conversationId: string) => A2AEvent[];
  deleteConversation: (id: string) => Promise<void>;
  clearAllConversations: () => void;
  getActiveConversation: () => Conversation | undefined;
  updateMessageFeedback: (conversationId: string, messageId: string, feedback: MessageFeedback) => void;
  updateConversationSharing: (conversationId: string, sharing: Conversation['sharing']) => void;
  updateConversationTitle: (conversationId: string, title: string) => Promise<void>;
  setPendingMessage: (message: string | null) => void;
  consumePendingMessage: () => string | null;
  loadConversationsFromServer: () => Promise<void>; // Load conversations from server (MongoDB mode only)
  saveMessagesToServer: (conversationId: string) => Promise<void>; // Save messages to MongoDB after streaming
  recoverInterruptedTask: (conversationId: string, messageId: string, endpoint: string, accessToken?: string) => Promise<boolean>; // Level 2: Poll tasks/get for interrupted messages
  loadMessagesFromServer: (conversationId: string, options?: { force?: boolean }) => Promise<void>; // Load messages from MongoDB when opening conversation
  evictOldMessageContent: (conversationId: string, messageIdsToEvict: string[]) => void; // Evict content from old messages to free memory

  // Turn selection actions for per-message event tracking
  setSelectedTurn: (conversationId: string, turnId: string | null) => void;
  getSelectedTurnId: (conversationId?: string) => string | null;
  getSelectedTurnEvents: (conversationId?: string) => A2AEvent[];
  isMessageSelectable: () => boolean;
  getTurnCount: (conversationId?: string) => number;
  getCurrentTurnIndex: (conversationId?: string) => number;
}

// Track loading state to prevent multiple simultaneous loads
let isLoadingConversations = false;

// Track which messages have been saved to MongoDB to avoid duplicates.
// Value is { isFinal, contentLength } — used to detect when a message needs
// a follow-up UPDATE (e.g., streaming finished and content/is_final changed).
const savedMessageIds = new Set<string>();
const savedMessageState = new Map<string, { isFinal: boolean; contentLength: number }>();

// Track in-flight and recently completed message loads to prevent:
// 1. Concurrent requests for the same conversation
// 2. Rapid re-fetches caused by React re-render loops (useEffect → store update → re-render)
// Maps conversationId → timestamp of last completed load. Calls within the cooldown
// window are skipped unless force=true (manual reload).
const messageLoadState = new Map<string, { inFlight: boolean; lastLoadedAt: number }>();
const MESSAGE_LOAD_COOLDOWN_MS = 5000; // 5 second cooldown between automatic syncs

// Track event counts per conversation for periodic saves during long streaming sessions.
// When event count hits the threshold, a background save is triggered to avoid data loss
// if the user closes the tab or the browser crashes mid-stream.
const eventCountSinceLastSave = new Map<string, number>();
const PERIODIC_SAVE_EVENT_THRESHOLD = 20; // Save every 20 events during streaming (reduced from 50 for better crash recovery)

// Serialize A2A event for MongoDB storage (strip circular refs and large raw data)
function serializeA2AEvent(event: A2AEvent): Record<string, unknown> {
  return {
    id: event.id,
    timestamp: event.timestamp,
    type: event.type,
    taskId: event.taskId,
    contextId: event.contextId,
    status: event.status,
    isFinal: event.isFinal,
    sourceAgent: event.sourceAgent,
    displayName: event.displayName,
    displayContent: event.displayContent,
    color: event.color,
    icon: event.icon,
    artifact: event.artifact ? {
      artifactId: event.artifact.artifactId,
      name: event.artifact.name,
      description: event.artifact.description,
      parts: event.artifact.parts?.map(p => ({
        kind: p.kind,
        text: p.text,
        ...(p.data ? { data: p.data } : {}),
      })),
      metadata: event.artifact.metadata,
    } : undefined,
    // Omit event.raw to avoid circular refs and large payloads
  };
}

// Create store with conditional persistence
const storeImplementation = (set: any, get: any) => ({
      conversations: [],
      activeConversationId: null,
      isStreaming: false,
      streamingConversations: new Map<string, StreamingState>(),
      a2aEvents: [],
      pendingMessage: null,
      selectedTurnIds: new Map<string, string>(),

      createConversation: () => {
        const id = generateId();
        const newConversation: Conversation = {
          id,
          title: "New Conversation",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [],
          a2aEvents: [], // Initialize with empty events
        };

        const storageMode = getStorageMode();

        // In MongoDB mode: create on server first
        // In localStorage mode: create locally
        if (storageMode === 'mongodb') {
          // MongoDB mode: Create on server with the same ID used locally
          apiClient.createConversation({
            id,
            title: newConversation.title,
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
          a2aEvents: [], // Clear global events for new conversation
        }));

        return id;
      },

      setActiveConversation: (id: string) => {
        // Just switch the active conversation
        // Events are now stored per-conversation, so no need to clear global events
        set({
          activeConversationId: id,
        });
      },

      addMessage: (conversationId: string, message: Omit<ChatMessage, "id" | "timestamp" | "events">, turnId?: string) => {
        const messageId = generateId();

        // Generate turnId for user messages, use provided turnId for assistant messages
        let messageTurnId = turnId;
        if (message.role === "user" && !turnId) {
          messageTurnId = generateId();
        }

        const newMessage: ChatMessage = {
          ...message,
          id: messageId,
          timestamp: new Date(),
          events: [],
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

        return messageId;
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

      addEventToMessage: (conversationId: string, messageId: string, event: A2AEvent) => {
        set((state: ChatState) => ({
          conversations: state.conversations.map((conv: Conversation) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg: ChatMessage) =>
                    msg.id === messageId
                      ? { ...msg, events: [...msg.events, event] }
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
            console.log(`[Store] Started streaming for conversation: ${conversationId}`);
          } else {
            newMap.delete(conversationId);
            console.log(`[Store] Stopped streaming for conversation: ${conversationId}, remaining: ${newMap.size}`);
          }
          // Update global isStreaming based on whether any conversation is streaming
          const newIsStreaming = newMap.size > 0;
          console.log(`[Store] Global isStreaming: ${newIsStreaming}`);
          return {
            streamingConversations: newMap,
            isStreaming: newIsStreaming,
          };
        });

        // When streaming completes, save messages to MongoDB
        if (!state) {
          // Reset periodic save counter for this conversation
          eventCountSinceLastSave.delete(conversationId);
          // Use setTimeout to let the final message update settle before saving
          setTimeout(() => {
            get().saveMessagesToServer(conversationId).catch((error) => {
              console.error('[ChatStore] Background save failed:', error);
            });
          }, 500);
        }
      },

      isConversationStreaming: (conversationId: string) => {
        return get().streamingConversations.has(conversationId);
      },

      cancelConversationRequest: (conversationId: string) => {
        const state = get();
        const streamingState = state.streamingConversations.get(conversationId);
        if (streamingState) {
          // Abort the A2A client
          streamingState.client.abort();
          // Remove from streaming map
          const newMap = new Map(state.streamingConversations);
          newMap.delete(conversationId);
          set({
            streamingConversations: newMap,
            isStreaming: newMap.size > 0,
          });
          // Mark the message as cancelled
          const conv = state.conversations.find((c: Conversation) => c.id === conversationId);
          const msg = conv?.messages.find((m: ChatMessage) => m.id === streamingState.messageId);
          if (msg && !msg.isFinal) {
            state.appendToMessage(conversationId, streamingState.messageId, "\n\n*Request cancelled*");
            state.updateMessage(conversationId, streamingState.messageId, { isFinal: true });
          }

          // Reset periodic save counter and save to MongoDB after cancel —
          // previously skipped because cancel bypassed setConversationStreaming(null).
          eventCountSinceLastSave.delete(conversationId);
          setTimeout(() => {
            get().saveMessagesToServer(conversationId).catch((error) => {
              console.error('[ChatStore] Save after cancel failed:', error);
            });
          }, 500);
        }
      },

      addA2AEvent: (event: A2AEvent, conversationId?: string) => {
        const convId = conversationId || get().activeConversationId;
        const artifactName = event.artifact?.name || 'n/a';
        const isImportant = ['execution_plan_update', 'execution_plan_status_update', 'tool_notification_start', 'tool_notification_end', 'final_result', 'partial_result'].includes(artifactName);
        if (isImportant) {
          const prevConv = get().conversations.find((c: Conversation) => c.id === convId);
          console.log(`[A2A-DEBUG] ➕ addA2AEvent: ${event.type}/${artifactName} to conv=${convId?.substring(0, 8)}`, {
            eventId: event.id,
            prevEventCount: prevConv?.a2aEvents?.length ?? 0,
            artifactText: event.artifact?.parts?.[0]?.text?.substring(0, 100),
          });
        }
        set((prev: ChatState) => {
          // Add to global events for current session display
          const newGlobalEvents = [...prev.a2aEvents, event];

          // Also add to the specific conversation's events if we have a convId
          if (convId) {
            const conv = prev.conversations.find((c: Conversation) => c.id === convId);
            const newCount = (conv?.a2aEvents?.length ?? 0) + 1;
            if (isImportant) {
              console.log(`[A2A-DEBUG] ➕ addA2AEvent APPLIED: conv=${convId?.substring(0, 8)} newEventCount=${newCount}`);
            }
            return {
              a2aEvents: newGlobalEvents,
              conversations: prev.conversations.map((c: Conversation) =>
                c.id === convId
                  ? { ...c, a2aEvents: [...c.a2aEvents, event] }
                  : c
              ),
            };
          }

          return { a2aEvents: newGlobalEvents };
        });

        // Periodic save: trigger a background save every PERIODIC_SAVE_EVENT_THRESHOLD
        // events to avoid data loss during long streaming sessions.
        if (convId) {
          const count = (eventCountSinceLastSave.get(convId) || 0) + 1;
          eventCountSinceLastSave.set(convId, count);
          if (count >= PERIODIC_SAVE_EVENT_THRESHOLD) {
            eventCountSinceLastSave.set(convId, 0);
            console.log(`[ChatStore] Periodic save triggered after ${PERIODIC_SAVE_EVENT_THRESHOLD} events for: ${convId}`);
            get().saveMessagesToServer(convId).catch((error) => {
              console.error('[ChatStore] Periodic save failed:', error);
            });
          }
        }
      },

      clearA2AEvents: (conversationId?: string) => {
        if (conversationId) {
          const prevConv = get().conversations.find((c: Conversation) => c.id === conversationId);
          const prevCount = prevConv?.a2aEvents?.length ?? 0;
          const prevExecPlans = prevConv?.a2aEvents?.filter((e: A2AEvent) => e.artifact?.name === 'execution_plan_update').length ?? 0;
          const prevToolStarts = prevConv?.a2aEvents?.filter((e: A2AEvent) => e.artifact?.name === 'tool_notification_start').length ?? 0;
          console.log(`[A2A-DEBUG] 🧹 clearA2AEvents(${conversationId.substring(0, 8)}): clearing ${prevCount} events (${prevExecPlans} exec_plans, ${prevToolStarts} tool_starts)`);
          // Clear events for a specific conversation
          set((prev: ChatState) => ({
            conversations: prev.conversations.map((conv: Conversation) =>
              conv.id === conversationId
                ? { ...conv, a2aEvents: [] }
                : conv
            ),
          }));
        } else {
          console.log(`[A2A-DEBUG] 🧹 clearA2AEvents(global): clearing ${get().a2aEvents.length} global events`);
          // Clear global session-only events
          set({ a2aEvents: [] });
        }
      },

      getConversationEvents: (conversationId: string) => {
        const conv = get().conversations.find((c: Conversation) => c.id === conversationId);
        return conv?.a2aEvents || [];
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
            a2aEvents: wasActiveConversation ? [] : state.a2aEvents,
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
          a2aEvents: [],
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

          // Get current local state to preserve messages
          const currentState = get();
          const localConversationsMap = new Map(
            currentState.conversations.map(conv => [conv.id, conv])
          );

          // Convert MongoDB conversations to local format, merging with local messages
          const serverConversations: Conversation[] = serverItems.map((conv) => {
            const localConv = localConversationsMap.get(conv._id);

            // If we have local messages, preserve them (they're more up-to-date)
            // Otherwise use empty array (messages will be loaded when conversation is opened)
            const localConvTyped = localConv as Conversation | undefined;
            const messages = localConvTyped?.messages && localConvTyped.messages.length > 0
              ? localConvTyped.messages
              : [];

            const a2aEvents = localConvTyped?.a2aEvents && localConvTyped.a2aEvents.length > 0
              ? localConvTyped.a2aEvents
              : [];

            // Preserve title from server (source of truth), but fallback to local if server title is missing/empty
            const title = (conv.title && conv.title.trim())
              ? conv.title
              : (localConvTyped?.title && localConvTyped.title.trim())
                ? localConvTyped.title
                : "New Conversation";

            console.log(`[ChatStore] Mapping conversation ${conv._id}:`, {
              serverTitle: conv.title,
              localTitle: localConvTyped?.title,
              finalTitle: title,
              hasMessages: messages.length > 0
            });

            return {
              id: conv._id,
              title,
              createdAt: new Date(conv.created_at),
              updatedAt: new Date(conv.updated_at),
              messages, // Preserve local messages if they exist
              a2aEvents, // Preserve local events if they exist
              sharing: conv.sharing,
            };
          });

          // Merge: Only keep local-only conversations if they're actively streaming
          // (meaning they were just created in this session and the server hasn't caught up).
          // Conversations deleted on another browser/device should NOT be preserved.
          const serverIds = new Set(serverConversations.map(c => c.id));
          const localOnlyConversations = currentState.conversations.filter(
            conv => !serverIds.has(conv.id) && currentState.streamingConversations.has(conv.id)
          );

          if (localOnlyConversations.length > 0) {
            console.log(`[ChatStore] Keeping ${localOnlyConversations.length} local-only conversations (actively streaming)`);
          }

          // Log removed conversations (deleted on another device)
          const removedConversations = currentState.conversations.filter(
            conv => !serverIds.has(conv.id) && !currentState.streamingConversations.has(conv.id)
          );
          if (removedConversations.length > 0) {
            console.log(`[ChatStore] Removing ${removedConversations.length} conversations deleted on server:`,
              removedConversations.map(c => ({ id: c.id.substring(0, 8), title: c.title }))
            );
          }

          // Combine server conversations with local-only conversations (only streaming ones)
          const mergedConversations = [...serverConversations, ...localOnlyConversations];

          // Always update with merged conversations to sync with server
          // But preserve local messages, events, and titles for conversations that exist locally.
          // IMPORTANT: Re-read current state here because loadMessagesFromServer may have
          // updated conversations between the time we started this function and now.
          // Without this, we'd overwrite events that loadMessagesFromServer just restored.
          const latestState = get();
          const finalConversations = mergedConversations.map(serverConv => {
            // Use latestState (not stale currentState) so we pick up events/messages
            // that loadMessagesFromServer may have populated in the meantime
            const localConv = latestState.conversations.find(c => c.id === serverConv.id)
              || currentState.conversations.find(c => c.id === serverConv.id);

            if (localConv) {
              // Preserve title from server (source of truth), but fallback to local
              const title = (serverConv.title && serverConv.title.trim())
                ? serverConv.title
                : (localConv.title && localConv.title.trim())
                  ? localConv.title
                  : "New Conversation";

              // Preserve local messages if they exist and server conv has none
              const messages = localConv.messages.length > 0 && serverConv.messages.length === 0
                ? localConv.messages
                : serverConv.messages.length > 0
                  ? serverConv.messages
                  : localConv.messages;

              // Preserve a2aEvents from local state — loadMessagesFromServer may have
              // restored them from MongoDB while this function was in-flight. Also preserve
              // per-message events (msg.events) by keeping the local messages reference.
              const a2aEvents = localConv.a2aEvents.length > 0
                ? localConv.a2aEvents
                : serverConv.a2aEvents;

              return {
                ...serverConv,
                title,
                messages,
                a2aEvents,
              };
            }

            // Ensure title is never empty
            if (!serverConv.title || !serverConv.title.trim()) {
              return {
                ...serverConv,
                title: "New Conversation"
              };
            }
            return serverConv;
          });

          const sortedConversations = finalConversations.sort(
            (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
          );

          // Log titles to debug
          console.log(`[ChatStore] Final conversations with titles:`,
            sortedConversations.map(c => ({ id: c.id.substring(0, 8), title: c.title, hasTitle: !!c.title }))
          );

          // Check if active conversation was deleted on another device
          const activeId = currentState.activeConversationId;
          const activeStillExists = activeId ? sortedConversations.some(c => c.id === activeId) : true;

          set({
            conversations: sortedConversations,
            // Clear active conversation if it was deleted on another device
            ...(activeId && !activeStillExists ? {
              activeConversationId: sortedConversations.length > 0 ? sortedConversations[0].id : null,
              a2aEvents: [],
            } : {}),
          });

          if (activeId && !activeStillExists) {
            console.log(`[ChatStore] Active conversation ${activeId.substring(0, 8)} was deleted on another device, switching to first conversation`);
          }

          console.log(`[ChatStore] Loaded ${serverConversations.length} conversations from MongoDB, merged with ${localOnlyConversations.length} local conversations, preserved messages for ${finalConversations.filter(c => c.messages.length > 0).length} conversations`);
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

      // Save messages to MongoDB after streaming completes
      saveMessagesToServer: async (conversationId: string) => {
        const storageMode = getStorageMode();
        if (storageMode !== 'mongodb') return;

        const state = get();
        const conv = state.conversations.find((c: Conversation) => c.id === conversationId);
        if (!conv || conv.messages.length === 0) return;

        // Partition messages into new (never saved) and stale (saved but content/final changed)
        const unsavedMessages: ChatMessage[] = [];
        const staleMessages: ChatMessage[] = [];

        for (const msg of conv.messages) {
          const key = `${conversationId}:${msg.id}`;
          if (!savedMessageIds.has(key)) {
            unsavedMessages.push(msg);
          } else {
            // Already saved — check if content or is_final changed since last save
            const prev = savedMessageState.get(key);
            if (prev) {
              const currentIsFinal = msg.isFinal ?? false;
              const contentChanged = (msg.content?.length || 0) !== prev.contentLength;
              const finalChanged = currentIsFinal && !prev.isFinal;
              if (contentChanged || finalChanged) {
                staleMessages.push(msg);
              }
            }
          }
        }

        if (unsavedMessages.length === 0 && staleMessages.length === 0) {
          console.log('[ChatStore] No new or stale messages to save for:', conversationId);
          return;
        }

        console.log(`[ChatStore] Saving ${unsavedMessages.length} new + ${staleMessages.length} stale messages to MongoDB for: ${conversationId}`);

        // A2A events during streaming are stored at the conversation level (conv.a2aEvents)
        // via addA2AEvent(), NOT on individual msg.events (addEventToMessage is not called).
        // To persist events to MongoDB, we attach the conversation-level events to the
        // last assistant message being saved (the one that was just streamed).
        const convEvents = conv.a2aEvents || [];
        const allMessagesToSave = [...unsavedMessages, ...staleMessages];
        const lastAssistantIdx = (() => {
          for (let i = allMessagesToSave.length - 1; i >= 0; i--) {
            if (allMessagesToSave[i].role === 'assistant') return i;
          }
          return -1;
        })();

        const execPlanCount = convEvents.filter((e: A2AEvent) => e.artifact?.name === 'execution_plan_update').length;
        const toolStartCount = convEvents.filter((e: A2AEvent) => e.artifact?.name === 'tool_notification_start').length;
        console.log(`[A2A-DEBUG] 💾 saveMessagesToServer: conv=${conversationId.substring(0, 8)}, convEvents=${convEvents.length} (${execPlanCount} exec_plans, ${toolStartCount} tool_starts), lastAssistantIdx=${lastAssistantIdx}, unsavedMsgs=${unsavedMessages.length}, staleMsgs=${staleMessages.length}`);

        // ── INSERT new messages ──
        for (let i = 0; i < unsavedMessages.length; i++) {
          const msg = unsavedMessages[i];
          // allMessagesToSave index for this message is i (unsaved are first)
          const allIdx = i;
          try {
            let serializedEvents: Record<string, unknown>[] | undefined;

            if (msg.events?.length > 0) {
              serializedEvents = msg.events.map(serializeA2AEvent);
            } else if (allIdx === lastAssistantIdx && convEvents.length > 0) {
              serializedEvents = convEvents.map(serializeA2AEvent);
              console.log(`[ChatStore] Attaching ${convEvents.length} conversation-level A2A events to assistant message ${msg.id}`);
            }

            await apiClient.addMessage(conversationId, {
              message_id: msg.id,
              role: msg.role,
              content: msg.content,
              metadata: {
                turn_id: msg.turnId || `turn-${Date.now()}`,
                is_final: msg.isFinal ?? false,
                ...(msg.taskId && { task_id: msg.taskId }),
                ...(msg.isInterrupted && { is_interrupted: msg.isInterrupted }),
              },
              a2a_events: serializedEvents,
            });

            const key = `${conversationId}:${msg.id}`;
            savedMessageIds.add(key);
            savedMessageState.set(key, {
              isFinal: msg.isFinal ?? false,
              contentLength: msg.content?.length || 0,
            });
          } catch (error: any) {
            console.error(`[ChatStore] Failed to save message ${msg.id}:`, error?.message);
          }
        }

        // ── UPDATE stale messages (content/metadata/events changed since last save) ──
        for (let i = 0; i < staleMessages.length; i++) {
          const msg = staleMessages[i];
          const allIdx = unsavedMessages.length + i;
          try {
            // Determine A2A events: if this is the last assistant in allMessagesToSave
            let serializedEvents: Record<string, unknown>[] | undefined;
            if (msg.events?.length > 0) {
              serializedEvents = msg.events.map(serializeA2AEvent);
            } else if (allIdx === lastAssistantIdx && convEvents.length > 0) {
              serializedEvents = convEvents.map(serializeA2AEvent);
              console.log(`[ChatStore] Attaching ${convEvents.length} conversation-level A2A events to stale assistant message ${msg.id}`);
            }

            await apiClient.updateMessage(msg.id, {
              content: msg.content,
              metadata: {
                is_final: msg.isFinal ?? true,
                is_interrupted: msg.isInterrupted ?? false,
                ...(msg.taskId && { task_id: msg.taskId }),
              },
              ...(serializedEvents && { a2a_events: serializedEvents }),
            });

            const key = `${conversationId}:${msg.id}`;
            savedMessageState.set(key, {
              isFinal: msg.isFinal ?? false,
              contentLength: msg.content?.length || 0,
            });
            console.log(`[ChatStore] Updated stale message ${msg.id} in MongoDB (isFinal=${msg.isFinal}, content=${(msg.content?.length || 0)} chars)`);
          } catch (error: any) {
            console.error(`[ChatStore] Failed to update stale message ${msg.id}:`, error?.message);
          }
        }

        console.log(`[ChatStore] Saved ${unsavedMessages.length} new + ${staleMessages.length} updated messages to MongoDB`);
      },

      // ═══════════════════════════════════════════════════════════════
      // LEVEL 2: Task recovery — poll tasks/get for interrupted messages
      // When a tab crashes or reloads mid-stream, the backend task may still
      // be running (or may have completed). This action checks the task status
      // and recovers the final result if available.
      // ═══════════════════════════════════════════════════════════════
      recoverInterruptedTask: async (conversationId: string, messageId: string, endpoint: string, accessToken?: string): Promise<boolean> => {
        const state = get();
        const conv = state.conversations.find((c: Conversation) => c.id === conversationId);
        if (!conv) return false;

        const msg = conv.messages.find((m: ChatMessage) => m.id === messageId);
        if (!msg || !msg.taskId || !msg.isInterrupted) return false;

        const taskId = msg.taskId;
        console.log(`[ChatStore] Attempting to recover interrupted task: ${taskId} for message ${messageId} via endpoint ${endpoint}`);

        // Use the legacy A2A client for tasks/get (it has the method built-in)
        const { A2AClient } = await import("@/lib/a2a-client");
        const client = new A2AClient({ endpoint, accessToken });

        const MAX_POLLS = 30; // Max 30 polls (5 minutes at 10s intervals)
        const POLL_INTERVAL = 10000; // 10 seconds between polls

        for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
          try {
            const result = await client.getTaskStatus(taskId) as any;

            if (result?.error) {
              // Task not found — backend may have restarted (InMemoryTaskStore lost)
              console.log(`[ChatStore] Task ${taskId} not found on server — marking as unrecoverable`);
              get().updateMessage(conversationId, messageId, {
                isInterrupted: false, // Clear the interrupted flag, nothing to recover
              });
              return false;
            }

            const task = result?.result;
            if (!task) {
              console.log(`[ChatStore] Task ${taskId} returned empty result`);
              get().updateMessage(conversationId, messageId, { isInterrupted: false });
              return false;
            }

            const taskState = task.status?.state;
            console.log(`[ChatStore] Task ${taskId} state: ${taskState} (poll ${attempt + 1}/${MAX_POLLS})`);

            if (taskState === "completed") {
              // Extract final content from task artifacts
              const artifacts = task.artifacts || [];
              let finalContent = "";
              for (const artifact of artifacts) {
                for (const part of artifact.parts || []) {
                  if (part.text) {
                    finalContent += part.text;
                  }
                }
              }

              if (finalContent) {
                console.log(`[ChatStore] Recovered ${finalContent.length} chars from completed task ${taskId}`);
                get().updateMessage(conversationId, messageId, {
                  content: finalContent,
                  isFinal: true,
                  isInterrupted: false,
                });
                // Save recovered content to MongoDB
                get().saveMessagesToServer(conversationId).catch((err) => {
                  console.error('[ChatStore] Failed to save recovered message:', err);
                });
                return true;
              } else {
                console.log(`[ChatStore] Task ${taskId} completed but no content in artifacts`);
                get().updateMessage(conversationId, messageId, { isInterrupted: false });
                return false;
              }
            }

            if (taskState === "failed" || taskState === "canceled" || taskState === "cancelled") {
              console.log(`[ChatStore] Task ${taskId} ended with state: ${taskState}`);
              get().updateMessage(conversationId, messageId, {
                isInterrupted: false,
                content: msg.content + `\n\n*Task ${taskState}. Use Retry to re-send the prompt.*`,
                isFinal: true,
              });
              return false;
            }

            // Task is still running — wait and poll again
            if (taskState === "working" || taskState === "submitted" || taskState === "input-required") {
              await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
              continue;
            }

            // Unknown state — stop polling
            console.log(`[ChatStore] Unknown task state: ${taskState} — stopping recovery`);
            get().updateMessage(conversationId, messageId, { isInterrupted: false });
            return false;
          } catch (error) {
            console.error(`[ChatStore] Error polling task ${taskId}:`, error);
            // On network error, stop trying — the user can manually retry
            get().updateMessage(conversationId, messageId, { isInterrupted: false });
            return false;
          }
        }

        // Exceeded max polls
        console.log(`[ChatStore] Task ${taskId} recovery timed out after ${MAX_POLLS} polls`);
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

        const state = get();
        const conv = state.conversations.find((c: Conversation) => c.id === conversationId);
        const hasLocalMessages = conv && conv.messages.length > 0;
        const hasLocalEvents = hasLocalMessages && (
          conv.a2aEvents.length > 0 ||
          conv.messages.some((m: ChatMessage) => m.events && m.events.length > 0)
        );

        messageLoadState.set(conversationId, { inFlight: true, lastLoadedAt: loadState?.lastLoadedAt ?? 0 });

        try {
          console.log(`[ChatStore] Loading messages from MongoDB for: ${conversationId} (hasLocalMessages=${hasLocalMessages}, hasLocalEvents=${hasLocalEvents})`);
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
            // Deserialize A2A events
            const events: A2AEvent[] = (msg.a2a_events || []).map((e: any) => ({
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
              events,
              isFinal,
              turnId: msg.metadata?.turn_id,
              taskId: msg.metadata?.task_id,
              // Mark as interrupted only if explicitly flagged in MongoDB, or
              // if this is the very last assistant message and it's not final
              // (genuinely mid-stream when saved, with no follow-up).
              isInterrupted: isExplicitlyInterrupted || (msg.role === 'assistant' && !isFinal),
              feedback: msg.feedback ? {
                type: msg.feedback.rating === 'positive' ? 'like' : msg.feedback.rating === 'negative' ? 'dislike' : null,
                submitted: true,
              } : undefined,
            };

            // Mark as already saved so we don't re-save or re-update unnecessarily
            const savedKey = `${conversationId}:${chatMsg.id}`;
            savedMessageIds.add(savedKey);
            savedMessageState.set(savedKey, {
              isFinal: chatMsg.isFinal ?? false,
              contentLength: chatMsg.content?.length || 0,
            });

            return chatMsg;
          });

          // Reconstruct a2aEvents for the ContextPanel / Tasks / Debug.
          // Only use events from the LAST assistant message (current/latest turn),
          // matching the live-streaming behavior where clearA2AEvents() is called
          // at the start of each new turn. This prevents completed tools from
          // old turns from accumulating in the Tasks panel.
          //
          // CRITICAL: If the conversation is currently streaming, do NOT overwrite
          // a2aEvents — they were cleared by clearA2AEvents() at the start of the
          // new turn and are being populated by addA2AEvent() from the live stream.
          // Overwriting them with MongoDB data would restore the PREVIOUS turn's
          // events, causing cross-turn contamination (e.g., showing "AWS accounts"
          // tasks when the user asked about "github profile").
          const isCurrentlyStreaming = get().streamingConversations.has(conversationId);
          const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
          const lastTurnEvents: A2AEvent[] = lastAssistantMsg?.events || [];
          const loadedExecPlans = lastTurnEvents.filter(e => e.artifact?.name === 'execution_plan_update').length;
          const loadedToolStarts = lastTurnEvents.filter(e => e.artifact?.name === 'tool_notification_start').length;
          console.log(`[A2A-DEBUG] 📥 loadMessagesFromServer: conv=${conversationId.substring(0, 8)}, msgs=${messages.length}, lastAssistant=${lastAssistantMsg?.id?.substring(0, 8) ?? 'NONE'}, lastTurnEvents=${lastTurnEvents.length} (${loadedExecPlans} exec_plans, ${loadedToolStarts} tool_starts), isStreaming=${isCurrentlyStreaming}`, {
            allMsgEventCounts: messages.map(m => ({ id: m.id.substring(0, 8), role: m.role, events: m.events.length })),
            execPlanTexts: lastTurnEvents.filter(e => e.artifact?.name === 'execution_plan_update').map(e => e.artifact?.parts?.[0]?.text?.substring(0, 100)),
          });

          if (isCurrentlyStreaming) {
            console.log(`[A2A-DEBUG] ⚠️ loadMessagesFromServer: SKIPPING a2aEvents overwrite — conversation is streaming (would restore stale events from previous turn)`);
          }

          if (hasLocalMessages) {
            // We have local message stubs — merge events AND any new messages
            // from MongoDB that don't exist locally (e.g., follow-up messages
            // from another device).
            const serverEventsByMsgId = new Map<string, A2AEvent[]>();
            for (const msg of messages) {
              if (msg.events.length > 0) {
                serverEventsByMsgId.set(msg.id, msg.events);
              }
            }

            // Build a set of local message IDs to detect new server messages
            const localMsgIds = new Set(conv!.messages.map((m: ChatMessage) => m.id));

            // Find messages on server that don't exist locally (follow-up from other device)
            const newServerMessages = messages.filter(m => !localMsgIds.has(m.id));

            set((state: ChatState) => ({
              conversations: state.conversations.map((c: Conversation) =>
                c.id === conversationId
                  ? {
                      ...c,
                      // Only overwrite a2aEvents if NOT currently streaming.
                      // During streaming, a2aEvents are managed by clearA2AEvents/addA2AEvent.
                      ...(isCurrentlyStreaming ? {} : { a2aEvents: lastTurnEvents }),
                      messages: [
                        // Existing local messages with events merged in
                        ...c.messages.map((localMsg: ChatMessage) => {
                          const serverEvents = serverEventsByMsgId.get(localMsg.id);
                          if (serverEvents && localMsg.events.length === 0) {
                            return { ...localMsg, events: serverEvents };
                          }
                          return localMsg;
                        }),
                        // Append new messages from server that don't exist locally
                        ...newServerMessages,
                      ],
                    }
                  : c
              ),
            }));

            const mergedEventCount = lastTurnEvents.length;
            console.log(`[ChatStore] Merged ${isCurrentlyStreaming ? 0 : mergedEventCount} A2A events (last turn, skipped=${isCurrentlyStreaming}) and ${newServerMessages.length} new messages from MongoDB into ${conv!.messages.length} local messages for: ${conversationId}`);
          } else {
            // No local messages — replace entirely with MongoDB data
            set((state: ChatState) => ({
              conversations: state.conversations.map((c: Conversation) =>
                c.id === conversationId
                  ? {
                      ...c,
                      messages,
                      // Only set a2aEvents if NOT currently streaming
                      ...(isCurrentlyStreaming ? {} : { a2aEvents: lastTurnEvents }),
                    }
                  : c
              ),
            }));

            console.log(`[ChatStore] Loaded ${messages.length} messages with ${isCurrentlyStreaming ? 0 : lastTurnEvents.length} events (last turn, skipped=${isCurrentlyStreaming}) from MongoDB for: ${conversationId}`);
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

      getSelectedTurnEvents: (conversationId) => {
        const state = get();
        const convId = conversationId || state.activeConversationId;
        if (!convId) return [];

        const conv = state.conversations.find((c) => c.id === convId);
        if (!conv) return [];

        const selectedTurnId = state.selectedTurnIds.get(convId);
        if (!selectedTurnId) {
          // No turn selected - return events from the most recent assistant message
          const lastAssistantMsg = [...conv.messages].reverse().find((m) => m.role === "assistant");
          return lastAssistantMsg?.events || [];
        }

        // Find the assistant message with the matching turnId
        const assistantMessage = conv.messages.find(
          (m) => m.role === "assistant" && m.turnId === selectedTurnId
        );
        return assistantMessage?.events || [];
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
            a2aEvents: [], // Don't persist events (too large)
            messages: conv.messages.map((msg) => ({
              ...msg,
              events: [], // Don't persist events
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
              a2aEvents: [],
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
                  events: [],
                  isFinal: healed ? true : msg.isFinal,
                  isInterrupted: healed
                    ? false
                    : (msg.role === 'assistant' && !msg.isFinal ? true : msg.isInterrupted),
                };
              }),
            }));
            state.a2aEvents = [];
            const storedArray = (state as unknown as { selectedTurnIdsArray?: [string, string][] }).selectedTurnIdsArray;
            state.selectedTurnIds = new Map(storedArray || []);
          }
        },
      })
    )
  : // MongoDB mode: Still use localStorage as cache, but sync with server
    // Keep messages in cache (they're the source of truth until saved to MongoDB)
    // but strip A2A events (too large for localStorage, will reload from MongoDB)
    create<ChatState>()(
      persist(storeImplementation, {
        name: "caipe-chat-history-mongodb-cache",
        storage: createJSONStorage(() => localStorage),
        partialize: (state) => ({
          conversations: state.conversations.map((conv) => ({
            ...conv,
            a2aEvents: [], // Don't persist events in localStorage (too large, stored in MongoDB)
            messages: conv.messages.map((msg) => ({
              ...msg,
              events: [], // Don't persist per-message events in localStorage (stored in MongoDB)
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
              a2aEvents: [],
              messages: conv.messages.map((msg, idx, allMsgs) => {
                // CRASH RECOVERY: same heal logic as localStorage mode above.
                let healed = false;
                if (msg.role === 'assistant' && !msg.isFinal) {
                  const hasFollowUp = allMsgs.slice(idx + 1).some(m => m.role === 'user');
                  if (hasFollowUp) healed = true;
                }
                return {
                  ...msg,
                  timestamp: new Date(msg.timestamp),
                  events: [],
                  isFinal: healed ? true : msg.isFinal,
                  isInterrupted: healed
                    ? false
                    : (msg.role === 'assistant' && !msg.isFinal ? true : msg.isInterrupted),
                };
              }),
            }));
            state.a2aEvents = [];
            const storedArray = (state as unknown as { selectedTurnIdsArray?: [string, string][] }).selectedTurnIdsArray;
            state.selectedTurnIds = new Map(storedArray || []);
          }
        },
      })
    );

// ═══════════════════════════════════════════════════════════════
// PERSISTENCE HARDENING: Save in-flight conversations on tab close / navigation
// ═══════════════════════════════════════════════════════════════
// Uses visibilitychange (recommended by Page Lifecycle API) as the primary handler,
// with beforeunload as a fallback. When the tab is hidden or the user navigates away,
// we save any conversations that were streaming to avoid data loss.
if (typeof window !== 'undefined') {
  const saveInflightConversations = () => {
    const state = useChatStore.getState();
    if (state.streamingConversations.size === 0) return;

    console.log(`[ChatStore] Tab hidden/closing — saving ${state.streamingConversations.size} in-flight conversation(s)`);
    for (const [conversationId] of state.streamingConversations) {
      // Reset periodic save counter
      eventCountSinceLastSave.delete(conversationId);
      // Fire-and-forget save (browser may kill the page before completion,
      // but periodic saves during streaming provide a safety net)
      state.saveMessagesToServer(conversationId).catch((error) => {
        console.error(`[ChatStore] Save on unload failed for ${conversationId}:`, error);
      });
    }
  };

  // Primary: visibilitychange fires reliably on tab close, navigation, app switch.
  // Browsers give ~5s of execution time for this handler.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      saveInflightConversations();
    }
  });

  // Fallback: beforeunload for older browsers and explicit tab close.
  window.addEventListener('beforeunload', saveInflightConversations);
}
