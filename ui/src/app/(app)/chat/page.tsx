"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { AuthGuard } from "@/components/auth-guard";
import { useChatStore } from "@/store/chat-store";

function ChatPage() {
  const router = useRouter();
  const conversations = useChatStore((state) => state.conversations);
  const loadConversationsFromServer = useChatStore((state) => state.loadConversationsFromServer);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    // Load conversations from server (MongoDB mode only)
    // Wait for it to complete before checking conversations
    const loadAndRedirect = async () => {
      setIsLoading(true);
      try {
        await loadConversationsFromServer();
        
        // Small delay to ensure store has updated
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // Get fresh conversations after load
        const currentConversations = useChatStore.getState().conversations;
        
        // Redirect to the most recent conversation, or show empty state
        if (currentConversations.length > 0) {
          const mostRecent = currentConversations[0];
          router.replace(`/chat/${mostRecent.id}`);
        }
      } catch (error) {
        console.error('[ChatPage] Failed to load conversations:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    loadAndRedirect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-4">
          <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground/50 animate-pulse" />
          <p className="text-sm text-muted-foreground/70">Loading conversations...</p>
        </div>
      </div>
    );
  }

  // Empty state when no conversations
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-4">
        <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground/50" />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold text-muted-foreground">No Conversations</h2>
          <p className="text-sm text-muted-foreground/70">
            Click "New Chat" in the sidebar to start a conversation
          </p>
        </div>
      </div>
    </div>
  );
}

export default function Chat() {
  return (
    <AuthGuard>
      <ChatPage />
    </AuthGuard>
  );
}
