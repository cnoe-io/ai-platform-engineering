"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { ContextPanel } from "@/components/a2a/ContextPanel";
import { AuthGuard } from "@/components/auth-guard";
import { getConfig } from "@/lib/config";
import { apiClient } from "@/lib/api-client";
import { useChatStore } from "@/store/chat-store";
import { getStorageMode } from "@/lib/storage-config";
import { Loader2 } from "lucide-react";
import type { Conversation } from "@/types/mongodb";
import type { Conversation as LocalConversation } from "@/types/a2a";

function ChatUUIDPage() {
  const params = useParams();
  const router = useRouter();
  const uuid = params.uuid as string;

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [contextPanelVisible, setContextPanelVisible] = useState(true);
  const [contextPanelCollapsed, setContextPanelCollapsed] = useState(false);
  const [debugMode, setDebugMode] = useState(false);

  const { conversations: localConversations, setActiveConversation, loadMessagesFromServer } = useChatStore();
  const caipeUrl = getConfig('caipeUrl');

  const handleTabChange = (tab: "chat" | "gallery" | "knowledge" | "admin") => {
    if (tab === "chat") {
      router.push("/chat");
    } else if (tab === "gallery") {
      router.push("/use-cases");
    } else if (tab === "admin") {
      router.push("/admin");
    } else {
      router.push("/knowledge-bases");
    }
  };

  // Check store immediately (synchronous, no loading state!)
  const existingConv = localConversations.find((c) => c.id === uuid);

  const [conversation, setConversation] = useState<Conversation | LocalConversation | null>(existingConv || null);
  const [loading, setLoading] = useState(!existingConv); // Only show spinner if NOT in store
  const [error, setError] = useState<string | null>(null);
  const storageMode = getStorageMode(); // Synchronous storage mode

  // Memoized callbacks (must be before early returns to maintain hooks order)
  const handleDebugModeChange = useCallback((enabled: boolean) => {
    setDebugMode(enabled);
  }, []);

  const handleContextPanelCollapse = useCallback((collapsed: boolean) => {
    setContextPanelCollapsed(collapsed);
  }, []);

  // Load conversation from MongoDB or localStorage
  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') {
      return;
    }

    async function loadConversation() {
      // Validate UUID format before making request
      if (!uuid || typeof uuid !== 'string') {
        setError("Invalid conversation ID");
        setLoading(false);
        return;
      }

      // Check Zustand store first (instant, no loading spinner!)
      const localConv = localConversations.find((c) => c.id === uuid);
      if (localConv) {
        console.log("[ChatUUID] Found conversation in store, loading instantly");
        setConversation(localConv);
        setActiveConversation(uuid);
        setLoading(false);

        // In MongoDB mode, sync messages from server in the background.
        // The local cache provides instant display, but we still need to:
        // 1. Restore A2A events stripped by localStorage partialize
        // 2. Pick up follow-up messages sent from other devices
        // 3. Keep Tasks and A2A Debug panels in sync
        //
        // IMPORTANT: When the conversation exists in the store but has NO messages
        // (e.g. after loadConversationsFromServer replaced store objects with
        // metadata-only entries from the list API), force a reload to ensure
        // messages appear immediately. This commonly happens when switching tabs
        // (Chat → Skills → Chat) because the Sidebar refreshes the conversation
        // list, replacing in-memory conversations with empty-message stubs.
        if (storageMode === 'mongodb') {
          const hasMessages = localConv.messages && localConv.messages.length > 0;
          loadMessagesFromServer(uuid, { force: !hasMessages }).catch((err) => {
            console.warn('[ChatUUID] Failed to load messages from server:', err);
          });
        }
        return;
      }

      // If conversation is not in store and we're NOT the active conversation,
      // this conversation might have been deleted - don't try to load it
      const currentActiveId = useChatStore.getState().activeConversationId;
      if (currentActiveId && currentActiveId !== uuid) {
        console.log("[ChatUUID] Not active conversation, aborting load (might be deleted)");
        setLoading(false);
        return;
      }

      console.log("[ChatUUID] Conversation not in store, loading from backend...");

      try {
        if (storageMode === 'mongodb') {
          // Try to load from MongoDB
          console.log("[ChatUUID] Loading from MongoDB...");
          try {
            const conv = await apiClient.getConversation(uuid);
            // Convert MongoDB conversation to local format
            const localConv: LocalConversation = {
              id: conv._id,
              title: conv.title,
              createdAt: new Date(conv.created_at),
              updatedAt: new Date(conv.updated_at),
              messages: [], // Will be loaded below via loadMessagesFromServer
              a2aEvents: [],
            };

            // Add to Zustand store so ContextPanel can find it
            useChatStore.setState((state) => ({
              conversations: [localConv, ...state.conversations.filter(c => c.id !== uuid)],
            }));

            setConversation(localConv);

            // Load messages from MongoDB (includes A2A events for tasks/debug)
            loadMessagesFromServer(uuid).catch((err) => {
              console.warn('[ChatUUID] Failed to load messages from server:', err);
            });
          } catch (apiErr: any) {
            // Check store again - it might have been added while we were fetching
            const storeConv = useChatStore.getState().conversations.find(c => c.id === uuid);
            if (storeConv) {
              console.log("[ChatUUID] Conversation appeared in store during fetch");
              setConversation(storeConv);
              return;
            }

            // Conversation doesn't exist in MongoDB (404) - this is expected for new conversations
            if (apiErr.message?.includes('not found') || apiErr.message?.includes('404')) {
              console.log("[ChatUUID] Conversation not found in MongoDB (expected for new conversations)");
            } else {
              console.warn("[ChatUUID] Failed to load from MongoDB:", apiErr.message);
            }
            // Create empty conversation for both cases
            const newConv: LocalConversation = {
              id: uuid,
              title: "New Conversation",
              createdAt: new Date(),
              updatedAt: new Date(),
              messages: [],
              a2aEvents: [],
            };

            // Add to Zustand store
            useChatStore.setState((state) => ({
              conversations: [newConv, ...state.conversations.filter(c => c.id !== uuid)],
            }));

            setConversation(newConv);
          }
        } else {
          // MongoDB not available, show empty conversation
          console.log("[ChatUUID] MongoDB unavailable, showing empty conversation");
          const newConv: LocalConversation = {
            id: uuid,
            title: "New Conversation",
            createdAt: new Date(),
            updatedAt: new Date(),
            messages: [],
            a2aEvents: [],
          };

          // Add to Zustand store
          useChatStore.setState((state) => ({
            conversations: [newConv, ...state.conversations.filter(c => c.id !== uuid)],
          }));

          setConversation(newConv);
        }
      } catch (err) {
        console.error("[ChatUUID] Unexpected error:", err);
        // Fallback to empty conversation
        const newConv: LocalConversation = {
          id: uuid,
          title: "New Conversation",
          createdAt: new Date(),
          updatedAt: new Date(),
          messages: [],
          a2aEvents: [],
        };

        // Add to Zustand store
        useChatStore.setState((state) => ({
          conversations: [newConv, ...state.conversations.filter(c => c.id !== uuid)],
        }));

        setConversation(newConv);
      } finally {
        // CRITICAL: Always set the active conversation, even when loading from MongoDB
        // This ensures the ContextPanel can display Tasks and A2A Debug
        setActiveConversation(uuid);
        setLoading(false);
      }
    }

    loadConversation();
  }, [uuid, localConversations, setActiveConversation]);

  // Show loading spinner only when actually fetching from MongoDB
  if (loading) {
    return (
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          activeTab="chat"
          onTabChange={handleTabChange}
          collapsed={sidebarCollapsed}
          onCollapse={setSidebarCollapsed}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading conversation...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          activeTab="chat"
          onTabChange={handleTabChange}
          collapsed={sidebarCollapsed}
          onCollapse={setSidebarCollapsed}
        />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm text-destructive">{error}</p>
            <button
              onClick={() => router.push("/chat")}
              className="text-sm text-primary hover:underline"
            >
              Go to new conversation
            </button>
          </div>
        </div>
      </div>
    );
  }

  const conversationTitle = conversation
    ? ('_id' in conversation ? conversation.title : conversation.title)
    : undefined;

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar - with conversation history */}
      <Sidebar
        activeTab="chat"
        onTabChange={handleTabChange}
        collapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
      />

      {/* Chat Panel with conversation ID */}
      <div className="flex-1 min-w-0 flex flex-col">
        <motion.div
          key="chat"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
          className="h-full flex flex-col"
        >
          <ChatPanel
            endpoint={caipeUrl}
            conversationId={uuid}
            conversationTitle={conversationTitle}
          />
        </motion.div>
      </div>

      {/* Context/Output Panel - kept in DOM tree, only visibility changes */}
      {contextPanelVisible && (
        <ContextPanel
          debugMode={debugMode}
          onDebugModeChange={handleDebugModeChange}
          collapsed={contextPanelCollapsed}
          onCollapse={handleContextPanelCollapse}
        />
      )}
    </div>
  );
}

export default function ChatUUID() {
  return (
    <AuthGuard>
      <ChatUUIDPage />
    </AuthGuard>
  );
}
