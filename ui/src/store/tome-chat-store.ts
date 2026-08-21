"use client";

import { create } from "zustand";

import type { Feedback } from "@/components/chat/FeedbackButton";
import type { ChatPart, ModelProvenance } from "@/types/tome";

export type TomeChatRole = "user" | "assistant";

export interface TomeChatMessage {
  id: string;
  role: TomeChatRole;
  parts: ChatPart[];
  pending?: boolean;
  system?: boolean;
  feedback?: Feedback;
  model?: string;
  modelProvenance?: ModelProvenance;
}

export interface TomeChatViewState {
  messages: TomeChatMessage[];
  streaming: boolean;
  compacting: boolean;
  hydrated: boolean;
  sessionId: string | null;
  sdkSessionId: string | null;
  readOnly: boolean;
  sessionOwner: string | null;
  contextUsage: { percentage: number } | null;
  /** Backend run being replayed after a browser reload. */
  resumeRunId: string | null;
  /** Where the global live-response banner should return for this stream. */
  streamDestination?: {
    href: string;
    label: string;
  };
}

export function emptyTomeChatViewState(): TomeChatViewState {
  return {
    messages: [],
    streaming: false,
    compacting: false,
    hydrated: false,
    sessionId: null,
    sdkSessionId: null,
    readOnly: false,
    sessionOwner: null,
    contextUsage: null,
    resumeRunId: null,
  };
}

export function tomeChatKey(slug: string, viewSessionId?: string | null): string {
  return `${slug}:${viewSessionId ?? "active"}`;
}

interface TomeChatStore {
  chats: Record<string, TomeChatViewState>;
  updateChat: (
    key: string,
    updater: (chat: TomeChatViewState) => TomeChatViewState,
  ) => void;
  hydrateChat: (key: string, chat: TomeChatViewState) => void;
  reset: () => void;
}

export const useTomeChatStore = create<TomeChatStore>((set) => ({
  chats: {},
  updateChat: (key, updater) => {
    set((state) => ({
      chats: {
        ...state.chats,
        [key]: updater(state.chats[key] ?? emptyTomeChatViewState()),
      },
    }));
  },
  hydrateChat: (key, chat) => {
    set((state) => {
      const current = state.chats[key];
      // A history request may have started before the user submitted a turn.
      // Never replace the live in-memory transcript with that stale response.
      if (current?.streaming || current?.compacting) {
        return {
          chats: {
            ...state.chats,
            [key]: {
              ...current,
              hydrated: true,
              readOnly: chat.readOnly,
              sessionOwner: chat.sessionOwner,
            },
          },
        };
      }
      return { chats: { ...state.chats, [key]: chat } };
    });
  },
  reset: () => set({ chats: {} }),
}));

export function selectTomeActiveStreamCount(state: TomeChatStore): number {
  return Object.values(state.chats).filter((chat) => chat.streaming).length;
}
