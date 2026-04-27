"use client";

import React, { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useChatStore } from "@/store/chat-store";
import { getStorageMode } from "@/lib/storage-config";
import { AuthGuard } from "@/components/auth-guard";

/**
 * /chat landing page — loads conversations from the server and redirects to
 * the most recent one if it exists. If there are no conversations, does nothing:
 * ChatContainer (always mounted in layout) shows an empty chat input and the
 * first conversation is created lazily when the user sends their first message.
 */
function ChatRedirectPage() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const redirected = useRef(false);

  const loadConversationsFromServer = useChatStore((s) => s.loadConversationsFromServer);

  useEffect(() => {
    if (status === "loading") return;
    if (redirected.current) return;

    const resolve = async () => {
      if (getStorageMode() === "mongodb") {
        await loadConversationsFromServer();
      }

      const state = useChatStore.getState();
      const { conversations, activeConversationId } = state;
      const userEmail = session?.user?.email;

      const owned = userEmail
        ? conversations.filter((c) => !c.owner_id || c.owner_id === userEmail)
        : conversations;

      // Resume last active conversation if still owned
      if (activeConversationId && owned.some((c) => c.id === activeConversationId)) {
        redirected.current = true;
        router.replace(`/chat/${activeConversationId}`);
        return;
      }

      // Fall back to most recent owned conversation
      if (owned.length > 0) {
        redirected.current = true;
        router.replace(`/chat/${owned[0].id}`);
        return;
      }

      // No conversations — stay on /chat, ChatContainer shows empty input.
      // Conversation created lazily when user sends first message.
      redirected.current = true;
    };

    resolve().catch((err) => {
      console.error("[ChatRedirect] Failed to load conversations:", err);
      redirected.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return null;
}

export default function Chat() {
  return (
    <AuthGuard>
      <ChatRedirectPage />
    </AuthGuard>
  );
}
