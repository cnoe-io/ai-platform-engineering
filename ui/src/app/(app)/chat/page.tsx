"use client";

import React, { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useChatStore } from "@/store/chat-store";
import { getStorageMode } from "@/lib/storage-config";
import { AuthGuard } from "@/components/auth-guard";
import { Loader2 } from "lucide-react";

/**
 * /chat landing page — resumes the last active conversation, falls back to
 * the most recent one, or creates a new conversation.
 *
 * Priority order:
 *  1. activeConversationId from the store (remembers the user's last selection
 *     across tab switches — e.g. Chat → Skills → Chat).
 *  2. The most recent conversation in the list (first visit / active was deleted).
 *  3. Create a brand-new conversation (empty history).
 *
 * This ensures the URL always contains a conversation UUID, which is required
 * for proper ChatPanel/ContextPanel rendering and MongoDB persistence.
 */
function ChatRedirectPage() {
  const router = useRouter();
  const redirected = useRef(false);

  const createConversation = useChatStore((s) => s.createConversation);
  const loadConversationsFromServer = useChatStore((s) => s.loadConversationsFromServer);

  useEffect(() => {
    if (redirected.current) return;

    const resolve = async () => {
      const storageMode = getStorageMode();

      // In MongoDB mode, ensure conversations are loaded from the server first
      if (storageMode === "mongodb") {
        await loadConversationsFromServer();
      }

      // Re-read from the store after potential server load
      const state = useChatStore.getState();
      const { conversations: currentConversations, activeConversationId } = state;

      // 1. Resume the last active conversation if it still exists
      if (activeConversationId) {
        const stillExists = currentConversations.some((c) => c.id === activeConversationId);
        if (stillExists) {
          redirected.current = true;
          router.replace(`/chat/${activeConversationId}`);
          return;
        }
      }

      // 2. Fall back to the most recent conversation (sorted by updatedAt)
      if (currentConversations.length > 0) {
        const latestId = currentConversations[0].id;
        redirected.current = true;
        router.replace(`/chat/${latestId}`);
      } else {
        // 3. No conversations — create a new one
        const newId = createConversation();
        redirected.current = true;
        router.replace(`/chat/${newId}`);
      }
    };

    resolve().catch((error) => {
      console.error("[ChatRedirect] Failed to resolve conversation:", error);
      // Fallback: create a new conversation
      if (!redirected.current) {
        const newId = createConversation();
        redirected.current = true;
        router.replace(`/chat/${newId}`);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex-1 flex items-center justify-center h-full bg-background">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <p className="text-sm">Loading conversations...</p>
      </div>
    </div>
  );
}

export default function Chat() {
  return (
    <AuthGuard>
      <ChatRedirectPage />
    </AuthGuard>
  );
}
