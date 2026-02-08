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
  loadMessagesFromServer: (conversationId: string) => Promise<void>; // Load messages from MongoDB when opening conversation

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

// Track which messages have been saved to MongoDB to avoid duplicates
const savedMessageIds = new Set<string>();

// Track which conversations have had messages loaded from MongoDB
const loadedConversationIds = new Set<string>();

// Serialize A2A event for MongoDB storage (strip circular refs and large raw data)
function serializeA2AEvent(event: A2AEvent): any {
  return {
    id: event.id,
    timestamp: event.timestamp,
    type: event.type,
    taskId: event.taskId,
    contextId: event.contextId,
    status: event.status,
    artifact: event.artifact ? {
      artifactId: event.artifact.artifactId,
      name: event.artifact.name,
      description: event.artifact.description,
      parts: event.artifact.parts?.map(p => ({
        kind: p.kind,
        text: p.text,
        // Skip large binary data
        ...(p.data ? { data: p.data } : {}),
      })),
    } : undefined,
    artifactName: event.artifactName,
    toolName: event.toolName,
    agentName: event.agentName,
    message: event.message,
    error: event.error,
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
        }
      },

      addA2AEvent: (event: A2AEvent, conversationId?: string) => {
        const convId = conversationId || get().activeConversationId;
        set((prev: ChatState) => {
          // Add to global events for current session display
          const newGlobalEvents = [...prev.a2aEvents, event];

          // Also add to the specific conversation's events if we have a convId
          if (convId) {
            return {
              a2aEvents: newGlobalEvents,
              conversations: prev.conversations.map((conv: Conversation) =>
                conv.id === convId
                  ? { ...conv, a2aEvents: [...conv.a2aEvents, event] }
                  : conv
              ),
            };
          }

          return { a2aEvents: newGlobalEvents };
        });
      },

      clearA2AEvents: (conversationId?: string) => {
        if (conversationId) {
          // Clear events for a specific conversation
          set((prev: ChatState) => ({
            conversations: prev.conversations.map((conv: Conversation) =>
              conv.id === conversationId
                ? { ...conv, a2aEvents: [] }
                : conv
            ),
          }));
        } else {
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

          // Merge: Add any local conversations that aren't on the server (might be newly created)
          const serverIds = new Set(serverConversations.map(c => c.id));
          const localOnlyConversations = currentState.conversations.filter(
            conv => !serverIds.has(conv.id)
          );

          // Combine server conversations with local-only conversations
          const mergedConversations = [...serverConversations, ...localOnlyConversations];

          // Always update with merged conversations to sync with server
          // But preserve local messages and titles for conversations that exist locally
          const finalConversations = mergedConversations.map(serverConv => {
            const localConv = currentState.conversations.find(c => c.id === serverConv.id);
            // If local has messages and server doesn't, keep local messages
            if (localConv && localConv.messages.length > 0 && serverConv.messages.length === 0) {
              // Also preserve title if server title is missing/empty but local has one
              const title = (serverConv.title && serverConv.title.trim())
                ? serverConv.title
                : (localConv.title && localConv.title.trim())
                  ? localConv.title
                  : "New Conversation";

              return {
                ...serverConv,
                title,
                messages: localConv.messages,
                a2aEvents: localConv.a2aEvents.length > 0 ? localConv.a2aEvents : serverConv.a2aEvents,
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

          set({
            conversations: sortedConversations,
          });
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

        // Find messages that haven't been saved yet
        const unsavedMessages = conv.messages.filter(
          (msg: ChatMessage) => !savedMessageIds.has(`${conversationId}:${msg.id}`)
        );

        if (unsavedMessages.length === 0) {
          console.log('[ChatStore] No new messages to save for:', conversationId);
          return;
        }

        console.log(`[ChatStore] Saving ${unsavedMessages.length} messages to MongoDB for: ${conversationId}`);

        for (const msg of unsavedMessages) {
          try {
            // Serialize A2A events for storage
            const serializedEvents = msg.events?.length > 0
              ? msg.events.map(serializeA2AEvent)
              : undefined;

            await apiClient.addMessage(conversationId, {
              message_id: msg.id,
              role: msg.role,
              content: msg.content,
              metadata: {
                turn_id: msg.turnId || `turn-${Date.now()}`,
                is_final: msg.isFinal,
              },
              a2a_events: serializedEvents,
            });

            savedMessageIds.add(`${conversationId}:${msg.id}`);
          } catch (error: any) {
            // Don't fail the whole save if one message fails
            console.error(`[ChatStore] Failed to save message ${msg.id}:`, error?.message);
          }
        }

        console.log(`[ChatStore] Saved ${unsavedMessages.length} messages to MongoDB`);
      },

      // Load messages from MongoDB when opening a conversation
      loadMessagesFromServer: async (conversationId: string) => {
        const storageMode = getStorageMode();
        if (storageMode !== 'mongodb') return;

        // Don't reload if already loaded
        if (loadedConversationIds.has(conversationId)) {
          console.log('[ChatStore] Messages already loaded for:', conversationId);
          return;
        }

        // Check if conversation already has messages locally
        const state = get();
        const conv = state.conversations.find((c: Conversation) => c.id === conversationId);
        if (conv && conv.messages.length > 0) {
          console.log('[ChatStore] Conversation already has local messages:', conversationId);
          loadedConversationIds.add(conversationId);
          return;
        }

        try {
          console.log('[ChatStore] Loading messages from MongoDB for:', conversationId);
          const response = await apiClient.getMessages(conversationId, { page_size: 100 });

          if (!response?.items || response.items.length === 0) {
            console.log('[ChatStore] No messages found in MongoDB for:', conversationId);
            loadedConversationIds.add(conversationId);
            return;
          }

          // Convert MongoDB messages to ChatMessage format
          const messages: ChatMessage[] = response.items.map((msg: any) => {
            // Deserialize A2A events
            const events: A2AEvent[] = (msg.a2a_events || []).map((e: any) => ({
              ...e,
              timestamp: new Date(e.timestamp),
            }));

            const chatMsg: ChatMessage = {
              id: msg.message_id || msg._id?.toString() || generateId(),
              role: msg.role as "user" | "assistant",
              content: msg.content,
              timestamp: new Date(msg.created_at),
              events,
              isFinal: msg.metadata?.is_final ?? true,
              turnId: msg.metadata?.turn_id,
              feedback: msg.feedback ? {
                type: msg.feedback.rating === 'positive' ? 'like' : msg.feedback.rating === 'negative' ? 'dislike' : null,
                submitted: true,
              } : undefined,
            };

            // Mark as already saved so we don't re-save
            savedMessageIds.add(`${conversationId}:${chatMsg.id}`);

            return chatMsg;
          });

          // Reconstruct a2aEvents from messages for the ContextPanel
          const allEvents: A2AEvent[] = messages.flatMap(m => m.events || []);

          // Update Zustand store with loaded messages
          set((state: ChatState) => ({
            conversations: state.conversations.map((c: Conversation) =>
              c.id === conversationId
                ? { ...c, messages, a2aEvents: allEvents }
                : c
            ),
          }));

          loadedConversationIds.add(conversationId);
          console.log(`[ChatStore] Loaded ${messages.length} messages from MongoDB for: ${conversationId}`);
        } catch (error: any) {
          if (error?.message?.includes('401') || error?.message?.includes('Unauthorized')) {
            console.log('[ChatStore] Not authenticated, skipping message load');
          } else if (error?.message?.includes('404')) {
            console.log('[ChatStore] Conversation not found in MongoDB (normal for new conversations)');
          } else {
            console.error('[ChatStore] Failed to load messages from MongoDB:', error);
          }
          loadedConversationIds.add(conversationId); // Don't retry on error
        }
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
              messages: conv.messages.map((msg) => ({
                ...msg,
                timestamp: new Date(msg.timestamp),
                events: [],
              })),
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
              messages: conv.messages.map((msg) => ({
                ...msg,
                timestamp: new Date(msg.timestamp),
                events: [],
              })),
            }));
            state.a2aEvents = [];
            const storedArray = (state as unknown as { selectedTurnIdsArray?: [string, string][] }).selectedTurnIdsArray;
            state.selectedTurnIds = new Map(storedArray || []);
          }
        },
      })
    );
