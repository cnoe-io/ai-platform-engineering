import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Conversation, ChatMessage, A2AEvent, MessageFeedback } from "@/types/a2a";
import { generateId } from "@/lib/utils";

// Track streaming state per conversation
// Using a generic client interface that requires abort() method
interface StreamingState {
  conversationId: string;
  messageId: string;
  client: { abort: () => void };
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
  deleteConversation: (id: string) => void;
  clearAllConversations: () => void;
  getActiveConversation: () => Conversation | undefined;
  updateMessageFeedback: (conversationId: string, messageId: string, feedback: MessageFeedback) => void;
  setPendingMessage: (message: string | null) => void;
  consumePendingMessage: () => string | null;
  
  // Turn selection actions for per-message event tracking
  setSelectedTurn: (conversationId: string, turnId: string | null) => void;
  getSelectedTurnId: (conversationId?: string) => string | null;
  getSelectedTurnEvents: (conversationId?: string) => A2AEvent[];
  isMessageSelectable: () => boolean;
  getTurnCount: (conversationId?: string) => number;
  getCurrentTurnIndex: (conversationId?: string) => number;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
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

        set((state) => ({
          conversations: [newConversation, ...state.conversations],
          activeConversationId: id,
          a2aEvents: [], // Clear global events for new conversation
        }));

        return id;
      },

      setActiveConversation: (id) => {
        // Just switch the active conversation
        // Events are now stored per-conversation, so no need to clear global events
        set({
          activeConversationId: id,
        });
      },

      addMessage: (conversationId, message, turnId) => {
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

        set((state) => {
          // Update selectedTurnIds when a new user message is added
          const newSelectedTurnIds = new Map(state.selectedTurnIds);
          if (message.role === "user" && messageTurnId) {
            newSelectedTurnIds.set(conversationId, messageTurnId);
            console.log(`[Store] New turn started: ${messageTurnId} for conversation ${conversationId}`);
          }
          
          return {
            conversations: state.conversations.map((conv) =>
              conv.id === conversationId
                ? {
                    ...conv,
                    messages: [...conv.messages, newMessage],
                    updatedAt: new Date(),
                    title: conv.messages.length === 0 && message.role === "user"
                      ? message.content.substring(0, 50)
                      : conv.title,
                  }
                : conv
            ),
            selectedTurnIds: newSelectedTurnIds,
          };
        });

        return messageId;
      },

      updateMessage: (conversationId, messageId, updates) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === messageId ? { ...msg, ...updates } : msg
                  ),
                  updatedAt: new Date(),
                }
              : conv
          ),
        }));
      },

      appendToMessage: (conversationId, messageId, content) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === messageId
                      ? { ...msg, content: msg.content + content }
                      : msg
                  ),
                }
              : conv
          ),
        }));
      },

      addEventToMessage: (conversationId, messageId, event) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === messageId
                      ? { ...msg, events: [...msg.events, event] }
                      : msg
                  ),
                }
              : conv
          ),
        }));
      },

      setStreaming: (streaming) => {
        set({ isStreaming: streaming });
      },

      setConversationStreaming: (conversationId, state) => {
        set((prev) => {
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
      },

      isConversationStreaming: (conversationId) => {
        return get().streamingConversations.has(conversationId);
      },

      cancelConversationRequest: (conversationId) => {
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
          const conv = state.conversations.find(c => c.id === conversationId);
          const msg = conv?.messages.find(m => m.id === streamingState.messageId);
          if (msg && !msg.isFinal) {
            state.appendToMessage(conversationId, streamingState.messageId, "\n\n*Request cancelled*");
            state.updateMessage(conversationId, streamingState.messageId, { isFinal: true });
          }
        }
      },

      addA2AEvent: (event, conversationId) => {
        const convId = conversationId || get().activeConversationId;
        set((prev) => {
          // Add to global events for current session display
          const newGlobalEvents = [...prev.a2aEvents, event];

          // Also add to the specific conversation's events if we have a convId
          if (convId) {
            return {
              a2aEvents: newGlobalEvents,
              conversations: prev.conversations.map((conv) =>
                conv.id === convId
                  ? { ...conv, a2aEvents: [...conv.a2aEvents, event] }
                  : conv
              ),
            };
          }

          return { a2aEvents: newGlobalEvents };
        });
      },

      clearA2AEvents: (conversationId) => {
        if (conversationId) {
          // Clear events for a specific conversation
          set((prev) => ({
            conversations: prev.conversations.map((conv) =>
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

      getConversationEvents: (conversationId) => {
        const conv = get().conversations.find((c) => c.id === conversationId);
        return conv?.a2aEvents || [];
      },

      deleteConversation: (id) => {
        set((state) => {
          const newConversations = state.conversations.filter((c) => c.id !== id);
          const wasActiveConversation = state.activeConversationId === id;

          return {
            conversations: newConversations,
            activeConversationId: wasActiveConversation
              ? newConversations[0]?.id || null
              : state.activeConversationId,
            // Clear A2A events when deleting the active conversation
            a2aEvents: wasActiveConversation ? [] : state.a2aEvents,
          };
        });
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
        return state.conversations.find((c) => c.id === state.activeConversationId);
      },

      updateMessageFeedback: (conversationId, messageId, feedback) => {
        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === messageId ? { ...msg, feedback } : msg
                  ),
                  updatedAt: new Date(),
                }
              : conv
          ),
        }));
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
    }),
    {
      name: "caipe-chat-history",
      storage: createJSONStorage(() => localStorage),
      // IMPORTANT: Do NOT persist a2aEvents - they're too large (900+ per query)
      // and cause localStorage overflow + browser crashes
      partialize: (state) => ({
        conversations: state.conversations.map((conv) => ({
          ...conv,
          // Exclude a2aEvents from persistence - too large
          a2aEvents: [],
          // Exclude message.events from persistence - too large
          messages: conv.messages.map((msg) => ({
            ...msg,
            events: [], // Don't persist events, only final content
          })),
        })),
        activeConversationId: state.activeConversationId,
        // Persist selectedTurnIds as an array of entries (Maps don't serialize well)
        selectedTurnIdsArray: Array.from(state.selectedTurnIds.entries()),
      }),
      // Handle date serialization
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Convert date strings back to Date objects
          // Events are NOT persisted (too large) - start with empty arrays
          state.conversations = state.conversations.map((conv) => ({
            ...conv,
            createdAt: new Date(conv.createdAt),
            updatedAt: new Date(conv.updatedAt),
            a2aEvents: [], // Events not persisted
            messages: conv.messages.map((msg) => ({
              ...msg,
              timestamp: new Date(msg.timestamp),
              events: [], // Events not persisted
            })),
          }));

          // Start with empty a2aEvents
          state.a2aEvents = [];
          
          // Restore selectedTurnIds from the persisted array
          const storedArray = (state as unknown as { selectedTurnIdsArray?: [string, string][] }).selectedTurnIdsArray;
          state.selectedTurnIds = new Map(storedArray || []);
        }
      },
    }
  )
);
