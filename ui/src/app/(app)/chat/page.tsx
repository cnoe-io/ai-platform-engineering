"use client";

import React, { useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useChatStore } from "@/store/chat-store";
import { getStorageMode } from "@/lib/storage-config";
import { getConfig } from "@/lib/config";
import { AuthGuard } from "@/components/auth-guard";
import { CAIPESpinner } from "@/components/ui/caipe-spinner";
import { Button } from "@/components/ui/button";

/**
 * /chat landing page — resumes the last active conversation, falls back to
 * the most recent one, or creates a new conversation.
 *
 * Priority order:
 *  1. activeConversationId from the store (remembers the user's last selection
 *     across tab switches — e.g. Chat → Skills → Chat), only if owned.
 *  2. The most recent OWNED conversation (first visit / active was deleted).
 *  3. Create a brand-new conversation (empty history).
 *
 * Only conversations owned by the current user are considered for auto-redirect.
 * Shared/public conversations are excluded to prevent cross-user context_id
 * collisions — the conversations API returns owned + shared + public in a
 * single list, and auto-selecting a public conversation would cause multiple
 * users to unknowingly share the same A2A context_id.
 */
function ChatRedirectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const redirected = useRef(false);
  const autonomousOnly = searchParams.get("source") === "autonomous";
  const autonomousAgentsEnabled = getConfig('autonomousAgentsEnabled');
  const [showAutonomousEmpty, setShowAutonomousEmpty] = React.useState(false);

  const createConversation = useChatStore((s) => s.createConversation);
  const loadConversationsFromServer = useChatStore((s) => s.loadConversationsFromServer);
  const loadAutonomousConversationsFromService = useChatStore((s) => s.loadAutonomousConversationsFromService);

  useEffect(() => {
    if (redirected.current) return;
    if (autonomousOnly && !autonomousAgentsEnabled) {
      redirected.current = true;
      router.replace("/chat");
      return;
    }
    setShowAutonomousEmpty(false);

    const resolve = async () => {
      const storageMode = getStorageMode();

      // In MongoDB mode, ensure conversations are loaded from the server first
      if (storageMode === "mongodb") {
        await loadConversationsFromServer(autonomousOnly ? { source: "autonomous" } : undefined);
      }

      if (autonomousOnly) {
        await loadAutonomousConversationsFromService();
      }

      // Re-read from the store after potential server load
      const state = useChatStore.getState();
      const { conversations: currentConversations, activeConversationId } = state;
      const userEmail = session?.user?.email;

      // Only consider conversations OWNED by the current user for auto-redirect.
      // The API returns shared/public conversations in the same list; picking one
      // of those would silently drop the user into someone else's conversation,
      // causing all their messages to share the same A2A context_id.
      // In localStorage mode, owner_id is unset — include those conversations.
      const ownedConversations = userEmail
        ? currentConversations.filter((c) => !c.owner_id || c.owner_id === userEmail)
        : currentConversations;
      const redirectCandidates = autonomousOnly
        ? ownedConversations.filter((c) => c.source === "autonomous")
        : ownedConversations;

      // 1. Resume the last active conversation if it still exists and is owned
      if (activeConversationId) {
        const stillOwned = redirectCandidates.some((c) => c.id === activeConversationId);
        if (stillOwned) {
          redirected.current = true;
          router.replace(`/chat/${activeConversationId}`);
          return;
        }
      }

      // 2. Fall back to the most recent OWNED conversation (sorted by updatedAt)
      if (redirectCandidates.length > 0) {
        const latestId = redirectCandidates[0].id;
        redirected.current = true;
        router.replace(`/chat/${latestId}`);
      } else if (autonomousOnly) {
        setShowAutonomousEmpty(true);
      } else {
        // 3. No owned conversations — create a new one
        const newId = await createConversation();
        redirected.current = true;
        router.replace(`/chat/${newId}`);
      }
    };

    resolve().catch(async (error) => {
      console.error("[ChatRedirect] Failed to resolve conversation:", error);
      // Fallback: create a new conversation
      if (!redirected.current) {
        if (autonomousOnly) {
          setShowAutonomousEmpty(true);
          return;
        }
        const newId = await createConversation();
        redirected.current = true;
        router.replace(`/chat/${newId}`);
      }
    });
  }, [autonomousOnly, autonomousAgentsEnabled, createConversation, loadAutonomousConversationsFromService, loadConversationsFromServer, router, session?.user?.email]);

  if (showAutonomousEmpty) {
    return (
      <div className="flex-1 flex items-center justify-center h-full bg-background">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm font-medium text-foreground">No autonomous task threads yet</p>
          <p className="max-w-sm text-xs text-muted-foreground">
            Create or run an autonomous task to generate a thread here.
          </p>
          <Button type="button" size="sm" onClick={() => router.push("/autonomous")}>
            Go to Autonomous Agents
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex items-center justify-center h-full bg-background">
      <CAIPESpinner size="lg" message="Loading conversations..." />
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
