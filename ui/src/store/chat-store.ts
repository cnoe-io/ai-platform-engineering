import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Conversation, ChatMessage, A2AEvent, MessageFeedback } from "@/types/a2a";
import { generateId } from "@/lib/utils";
import { A2AClient } from "@/lib/a2a-client";

// PERFORMANCE FIX: Clear corrupted localStorage before store initialization
// This runs once on module load to prevent OOM crashes from legacy data
const STORAGE_KEY = "caipe-chat-history";
const MAX_STORAGE_SIZE = 5 * 1024 * 1024; // 5MB limit

if (typeof window !== "undefined") {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const sizeBytes = new Blob([stored]).size;
      if (sizeBytes > MAX_STORAGE_SIZE) {
        console.warn(
          `[ChatStore] Clearing oversized localStorage (${(sizeBytes / 1024 / 1024).toFixed(1)}MB > ${MAX_STORAGE_SIZE / 1024 / 1024}MB limit)`
        );
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  } catch {
    // If we can't even read it, clear it
    localStorage.removeItem(STORAGE_KEY);
  }
}

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
  addA2AEvent: (event: A2AEvent, conversationId?: string) => void;
  clearA2AEvents: (conversationId?: string) => void;
  getConversationEvents: (conversationId: string) => A2AEvent[];
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
        // Just switch the active conversation
        // Events are now stored per-conversation, so no need to clear global events
        set({
          activeConversationId: id,
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
        // PERFORMANCE: Limit events per message to prevent OOM
        const MAX_MESSAGE_EVENTS = 100;

        // Strip heavy 'raw' property
        const lightEvent = {
          ...event,
          raw: undefined,
        };

        set((state) => ({
          conversations: state.conversations.map((conv) =>
            conv.id === conversationId
              ? {
                  ...conv,
                  messages: conv.messages.map((msg) =>
                    msg.id === messageId
                      ? {
                          ...msg,
                          events: [...msg.events, lightEvent].slice(-MAX_MESSAGE_EVENTS),
                        }
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

      addA2AEvent: (event, conversationId) => {
        const convId = conversationId || get().activeConversationId;
        // PERFORMANCE: Limit events to prevent OOM (keep last 200 per conversation)
        const MAX_EVENTS = 200;

        // Strip the heavy 'raw' property from events before storing
        const lightEvent = {
          ...event,
          raw: undefined, // Don't store raw JSON-RPC responses
        };

        set((prev) => {
          // Add to global events for current session display (limited)
          const newGlobalEvents = [...prev.a2aEvents, lightEvent].slice(-MAX_EVENTS);

          // Also add to the specific conversation's events if we have a convId
          if (convId) {
            return {
              a2aEvents: newGlobalEvents,
              conversations: prev.conversations.map((conv) =>
                conv.id === convId
                  ? {
                      ...conv,
                      a2aEvents: [...conv.a2aEvents, lightEvent].slice(-MAX_EVENTS),
                    }
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
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // PERFORMANCE FIX: Only persist essential data, NOT events
      // Events can be 900+ per query with large payloads - causes OOM
      partialize: (state) => ({
        conversations: state.conversations.map((conv) => ({
          ...conv,
          // DO NOT persist a2aEvents - they're huge and cause OOM
          a2aEvents: [],
          // Strip events from messages too - only content matters for history
          messages: conv.messages.map((msg) => ({
            ...msg,
            events: [], // Don't persist per-message events
          })),
        })),
        activeConversationId: state.activeConversationId,
      }),
      // Handle date serialization
      onRehydrateStorage: () => (state) => {
        if (state) {
          // Convert date strings back to Date objects
          // Events are NOT persisted for performance, so initialize as empty
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
        }
      },
    }
  )
);
