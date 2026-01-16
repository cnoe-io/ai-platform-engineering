import { create } from "zustand";
import { Conversation, ChatMessage, A2AEvent } from "@/types/a2a";
import { generateId } from "@/lib/utils";

interface ChatState {
  conversations: Conversation[];
  activeConversationId: string | null;
  isStreaming: boolean;
  a2aEvents: A2AEvent[];

  // Actions
  createConversation: () => string;
  setActiveConversation: (id: string) => void;
  addMessage: (conversationId: string, message: Omit<ChatMessage, "id" | "timestamp" | "events">) => string;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<ChatMessage>) => void;
  appendToMessage: (conversationId: string, messageId: string, content: string) => void;
  addEventToMessage: (conversationId: string, messageId: string, event: A2AEvent) => void;
  setStreaming: (streaming: boolean) => void;
  addA2AEvent: (event: A2AEvent) => void;
  clearA2AEvents: () => void;
  deleteConversation: (id: string) => void;
  getActiveConversation: () => Conversation | undefined;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversations: [],
  activeConversationId: null,
  isStreaming: false,
  a2aEvents: [],

  createConversation: () => {
    const id = generateId();
    const newConversation: Conversation = {
      id,
      title: "New Conversation",
      createdAt: new Date(),
      updatedAt: new Date(),
      messages: [],
    };

    set((state) => ({
      conversations: [newConversation, ...state.conversations],
      activeConversationId: id,
    }));

    return id;
  },

  setActiveConversation: (id) => {
    set({ activeConversationId: id, a2aEvents: [] });
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

  addA2AEvent: (event) => {
    set((state) => ({
      a2aEvents: [...state.a2aEvents, event],
    }));
  },

  clearA2AEvents: () => {
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

  getActiveConversation: () => {
    const state = get();
    return state.conversations.find((c) => c.id === state.activeConversationId);
  },
}));
