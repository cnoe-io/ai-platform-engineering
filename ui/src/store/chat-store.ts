import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Conversation, ChatMessage, A2AEvent, MessageFeedback } from "@/types/a2a";
import { generateId } from "@/lib/utils";
import { A2AClient } from "@/lib/a2a-client";

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

  // Actions
  createConversation: () => string;
  setActiveConversation: (id: string) => void;
  addMessage: (conversationId: string, message: Omit<ChatMessage, "id" | "timestamp" | "events">) => string;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  appendToMessage: (conversationId: string, messageId: string, content: string) => void;
  addEventToMessage: (conversationId: string, messageId: string, event: A2AEvent) => void;
  setStreaming: (streaming: boolean) => void;
  setConversationStreaming: (conversationId: string, state: StreamingState | null) => void;
  isConversationStreaming: (conversationId: string) => boolean;
  cancelConversationRequest: (conversationId: string) => void;
  addA2AEvent: (event: A2AEvent) => void;
  clearA2AEvents: () => void;
  deleteConversation: (id: string) => void;
  clearAllConversations: () => void;
  getActiveConversation: () => Conversation | undefined;
  updateMessageFeedback: (conversationId: string, messageId: string, feedback: MessageFeedback) => void;
  setPendingMessage: (message: string | null) => void;
  consumePendingMessage: () => string | null;
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
        // Clear a2aEvents when switching conversations
        // Events are session-only and specific to the current interaction
        set({
          activeConversationId: id,
          a2aEvents: [], // Fresh start for each conversation switch
        });
      },

      addMessage: (conversationId, message) => {
        const messageId = generateId();
        const newMessage: ChatMessage = {
          ...message,
          id: messageId,
          timestamp: new Date(),
          events: [],
        };

        set((state) => ({
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
        }));

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
          } else {
            newMap.delete(conversationId);
          }
          // Update global isStreaming based on whether any conversation is streaming
          return {
            streamingConversations: newMap,
            isStreaming: newMap.size > 0,
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

      addA2AEvent: (event) => {
        // Add to global events for current session display only
        // Events are transient and not persisted to localStorage
        set((prev) => ({
          a2aEvents: [...prev.a2aEvents, event],
        }));
      },

      clearA2AEvents: () => {
        // Clear session-only events
        set({ a2aEvents: [] });
      },

      deleteConversation: (id) => {
        set((state) => {
          const newConversations = state.conversations.filter((c) => c.id !== id);
          return {
            conversations: newConversations,
            activeConversationId:
              state.activeConversationId === id
                ? newConversations[0]?.id || null
                : state.activeConversationId,
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
    }),
    {
      name: "caipe-chat-history",
      storage: createJSONStorage(() => localStorage),
      // Only persist conversations (without a2aEvents) and activeConversationId
      // a2aEvents are transient - they don't persist across sessions
      // This prevents accumulation of old events
      partialize: (state) => ({
        // Strip a2aEvents from conversations before persisting
        conversations: state.conversations.map((conv) => ({
          ...conv,
          a2aEvents: [], // Don't persist a2aEvents
        })),
        activeConversationId: state.activeConversationId,
      }),
      // Handle date serialization
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Convert date strings back to Date objects
          state.conversations = state.conversations.map((conv) => ({
            ...conv,
            createdAt: new Date(conv.createdAt),
            updatedAt: new Date(conv.updatedAt),
            a2aEvents: [], // Start fresh - no persisted events
            messages: conv.messages.map((msg) => ({
              ...msg,
              timestamp: new Date(msg.timestamp),
              // Restore event timestamps for message-level events
              events: msg.events.map((event) => ({
                ...event,
                timestamp: new Date(event.timestamp),
              })),
            })),
          }));

          // Start with empty a2aEvents
          state.a2aEvents = [];
        }
      },
    }
  )
);
